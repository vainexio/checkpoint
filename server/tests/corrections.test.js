import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.JWT_SECRET = 'test-secret-not-used-anywhere-real';

const minutesAgo = (m) => new Date(Date.now() - m * 60000).toISOString();

let mongod;
let app;
let models;

before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  const { createApp } = await import('../app.js');
  models = await import('../models/index.js');
  app = createApp();
});

after(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

let w;

/** Araneta → Balintawak → Tarlac, a trip that left 90 minutes ago. */
beforeEach(async () => {
  for (const model of Object.values(models)) await model.deleteMany({});

  await models.User.create({
    name: 'Ops Admin',
    username: 'admin',
    role: 'admin',
    passwordHash: await models.User.hashPassword('checkpoint123'),
  });
  const adminToken = (
    await request(app).post('/api/auth/login').send({ username: 'admin', password: 'checkpoint123' })
  ).body.token;
  const asAdmin = (req) => req.set('Authorization', `Bearer ${adminToken}`);

  const cps = [];
  for (const name of ['Araneta', 'Balintawak', 'Tarlac']) {
    cps.push(
      (await asAdmin(request(app).post('/api/admin/checkpoints')).send({ name, type: 'station' }))
        .body
    );
  }
  const route = await asAdmin(request(app).post('/api/admin/routes')).send({
    name: 'Cubao – Tarlac',
    checkpoints: [
      { checkpoint: cps[0]._id, baselineMinutesFromPrevious: 0 },
      { checkpoint: cps[1]._id, baselineMinutesFromPrevious: 30 },
      { checkpoint: cps[2]._id, baselineMinutesFromPrevious: 120 },
    ],
  });
  const bus = await asAdmin(request(app).post('/api/admin/buses')).send({
    plateNumber: 'NRT 8821',
    operatorName: 'Northline Express',
  });
  const conductor = await asAdmin(request(app).post('/api/admin/conductors')).send({
    name: 'Rey Santiago',
    username: 'rey',
    password: 'checkpoint123',
  });
  const trip = await asAdmin(request(app).post('/api/admin/trips')).send({
    routeId: route.body._id,
    busId: bus.body._id,
    conductorId: conductor.body._id,
    scheduledDeparture: minutesAgo(90),
  });
  const conductorToken = (
    await request(app).post('/api/auth/login').send({ username: 'rey', password: 'checkpoint123' })
  ).body.token;

  w = {
    asAdmin,
    asConductor: (req) => req.set('Authorization', `Bearer ${conductorToken}`),
    tripId: trip.body.trip.id,
    araneta: cps[0]._id,
    balintawak: cps[1]._id,
    tarlac: cps[2]._id,
  };
});

const tap = (body) =>
  w
    .asConductor(request(app).post(`/api/conductor/trips/${w.tripId}/checkpoint-logs`))
    .send({ clientLogId: `tap-${Math.random()}`, ...body })
    .expect(201);

const record = () => w.asAdmin(request(app).get(`/api/admin/trips/${w.tripId}`)).expect(200);

test('an admin sees the whole log stream, and an empty trail to begin with', async () => {
  await tap({ type: 'departed', reportedAt: minutesAgo(90) });
  const res = await record();
  assert.equal(res.body.logs.length, 1);
  assert.deepEqual(res.body.corrections, []);
});

test('a checkpoint tapped at the wrong stop an hour ago can be moved, and the trip replays', async () => {
  await tap({ type: 'departed', reportedAt: minutesAgo(90) });
  // Tapped Tarlac by mistake at Balintawak, 58 minutes ago.
  await tap({ type: 'passed_checkpoint', checkpoint: w.tarlac, reportedAt: minutesAgo(58) });

  let res = await record();
  assert.equal(res.body.trip.lastConfirmedCheckpoint.name, 'Tarlac');
  const wrong = res.body.logs.find((l) => l.type === 'passed_checkpoint');

  res = await w
    .asAdmin(request(app).put(`/api/admin/trips/${w.tripId}/logs/${wrong._id}`))
    .send({ checkpoint: w.balintawak, reason: 'Tapped the wrong stop' })
    .expect(200);

  // Replayed as though the mistake never happened: at Balintawak 32 minutes
  // in against a 30-minute baseline.
  assert.equal(res.body.trip.lastConfirmedCheckpoint.name, 'Balintawak');
  assert.equal(res.body.trip.varianceMinutes, 2);
  assert.equal(res.body.trip.stops[2].progress, 'pending');

  const [entry] = res.body.corrections;
  assert.equal(entry.action, 'edited');
  assert.equal(entry.adminName, 'Ops Admin');
  assert.equal(entry.before.checkpoint, w.tarlac);
  assert.equal(entry.after.checkpoint, w.balintawak);
  assert.equal(entry.reason, 'Tapped the wrong stop');
  assert.ok(entry.createdAt);
});

test('past the conductor undo window, only an admin can remove a tap', async () => {
  await tap({ type: 'departed', reportedAt: minutesAgo(90) });
  await tap({ type: 'arrived', reportedAt: minutesAgo(40), clientLogId: 'early-arrival' });

  await w
    .asConductor(request(app).delete(`/api/conductor/trips/${w.tripId}/checkpoint-logs/early-arrival`))
    .expect(409);

  const arrival = (await record()).body.logs.find((l) => l.type === 'arrived');
  const res = await w
    .asAdmin(request(app).delete(`/api/admin/trips/${w.tripId}/logs/${arrival._id}`))
    .send({ reason: 'Bus had not arrived' })
    .expect(200);

  assert.notEqual(res.body.trip.status, 'arrived');
  assert.equal(res.body.logs.length, 1);
  assert.equal(res.body.corrections[0].action, 'deleted');
  assert.equal(res.body.corrections[0].before.type, 'arrived');
});

test('a missed departure can be filled in, and is marked as the dispatcher’s', async () => {
  // The conductor never tapped "departed", so this pass cannot be placed.
  await tap({ type: 'passed_checkpoint', checkpoint: w.balintawak, reportedAt: minutesAgo(60) });
  assert.equal((await record()).body.trip.actualDeparture, null);

  const res = await w
    .asAdmin(request(app).post(`/api/admin/trips/${w.tripId}/logs`))
    .send({ type: 'departed', reportedAt: minutesAgo(90), reason: 'Conductor forgot to tap' })
    .expect(201);

  assert.ok(res.body.trip.actualDeparture);
  assert.equal(res.body.trip.lastConfirmedCheckpoint.name, 'Balintawak');
  assert.deepEqual(res.body.trip.ignoredLogs, []);

  const added = res.body.logs.find((l) => l.type === 'departed');
  assert.equal(added.recordedBy, 'admin');
  assert.equal(res.body.corrections[0].action, 'added');
});

test('a correction that makes no sense is refused', async () => {
  await tap({ type: 'departed', reportedAt: minutesAgo(90) });
  const log = (await record()).body.logs[0];

  // In the future.
  await w
    .asAdmin(request(app).put(`/api/admin/trips/${w.tripId}/logs/${log._id}`))
    .send({ reportedAt: new Date(Date.now() + 3600000).toISOString() })
    .expect(400);

  // Nothing actually changed.
  await w
    .asAdmin(request(app).put(`/api/admin/trips/${w.tripId}/logs/${log._id}`))
    .send({ reportedAt: log.reportedAt })
    .expect(400);

  // A checkpoint that is not on this trip.
  await w
    .asAdmin(request(app).post(`/api/admin/trips/${w.tripId}/logs`))
    .send({
      type: 'passed_checkpoint',
      checkpoint: new mongoose.Types.ObjectId().toString(),
      reportedAt: minutesAgo(10),
    })
    .expect(400);

  // No time given.
  await w
    .asAdmin(request(app).post(`/api/admin/trips/${w.tripId}/logs`))
    .send({ type: 'arrived' })
    .expect(400);

  // None of it touched the trail.
  assert.deepEqual((await record()).body.corrections, []);
});

test('a conductor cannot reach the correction tools', async () => {
  await tap({ type: 'departed', reportedAt: minutesAgo(90) });
  const log = (await record()).body.logs[0];

  await w
    .asConductor(request(app).delete(`/api/admin/trips/${w.tripId}/logs/${log._id}`))
    .expect(403);
  await w
    .asConductor(request(app).post(`/api/admin/trips/${w.tripId}/logs`))
    .send({ type: 'arrived', reportedAt: minutesAgo(1) })
    .expect(403);
});

test('moving a tap to another checkpoint forgets the road reading it carried', async () => {
  await tap({ type: 'departed', reportedAt: minutesAgo(90) });
  await tap({ type: 'passed_checkpoint', checkpoint: w.tarlac, reportedAt: minutesAgo(58) });
  const pass = await models.CheckpointLog.findOne({ type: 'passed_checkpoint' });
  pass.trafficAllowanceMinutes = 9;
  await pass.save();

  await w
    .asAdmin(request(app).put(`/api/admin/trips/${w.tripId}/logs/${pass._id}`))
    .send({ checkpoint: w.balintawak })
    .expect(200);

  // It described the leg into Tarlac; for the leg into Balintawak it is unknown.
  assert.equal((await models.CheckpointLog.findById(pass._id)).trafficAllowanceMinutes, null);
});
