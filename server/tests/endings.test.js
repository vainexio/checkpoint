import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { addMinutes, computeTripState } from '../services/etaEngine.js';
import { closeAbandonedTrips, isAbandoned, SILENT_FOR_HOURS } from '../services/housekeeping.js';

process.env.JWT_SECRET = 'test-secret-not-used-anywhere-real';

const HOUR = 60 * 60 * 1000;
const minutesAgo = (m) => new Date(Date.now() - m * 60000);

/* ------------------------------------------- a run that ends early, pure -- */

const plan = [
  { checkpoint: 'a', name: 'PITX', type: 'station', baselineMinutesFromPrevious: 0 },
  { checkpoint: 'b', name: 'Alabang', type: 'station', baselineMinutesFromPrevious: 40 },
  { checkpoint: 'c', name: 'Turbina', type: 'station', baselineMinutesFromPrevious: 40 },
  { checkpoint: 'd', name: 'Lipa', type: 'station', baselineMinutesFromPrevious: 60 },
];
const DEPARTURE = new Date('2026-09-24T09:00:00+08:00');
const log = (type, minutes, extra = {}) => ({
  type,
  reportedAt: addMinutes(DEPARTURE, minutes),
  clientLogId: `${type}-${minutes}`,
  ...extra,
});

test('a bus that cannot finish ends the trip where it stands', () => {
  const state = computeTripState({
    plan,
    logs: [
      log('departed', 0),
      log('passed_checkpoint', 41, { checkpoint: 'b' }),
      log('terminated', 60, { delayReason: 'breakdown' }),
    ],
  });

  assert.equal(state.status, 'cancelled');
  assert.equal(state.terminated.reason, 'breakdown');
  assert.equal(state.terminated.nearCheckpoint, 'Alabang');
  assert.equal(state.actualArrival, null);

  const eta = (id) => state.computedETAs.find((e) => e.checkpoint === id);
  // What happened is kept; what was going to happen is withdrawn, because a
  // time here would be read as a promise.
  assert.ok(eta('b').actualArrival);
  assert.equal(eta('c').projectedArrival, null);
  assert.equal(eta('d').projectedArrival, null);
});

test('a bus that never started can be reported from the bay', () => {
  const state = computeTripState({ plan, logs: [log('terminated', -5, { delayReason: 'breakdown' })] });
  assert.equal(state.status, 'cancelled');
  assert.equal(state.actualDeparture, null);
  assert.equal(state.terminated.nearCheckpoint, null);
});

test('a trip that already arrived cannot be cancelled afterwards', () => {
  const state = computeTripState({
    plan,
    logs: [log('departed', 0), log('arrived', 140), log('terminated', 150)],
  });
  assert.equal(state.status, 'arrived');
  assert.equal(state.terminated, null);
  assert.equal(state.ignoredLogs[0].reason, 'after_arrival');
});

test('a second termination changes nothing', () => {
  const state = computeTripState({
    plan,
    logs: [log('departed', 0), log('terminated', 50, { delayReason: 'breakdown' }), log('terminated', 70, { delayReason: 'weather' })],
  });
  assert.equal(state.terminated.reason, 'breakdown');
  assert.equal(state.ignoredLogs[0].reason, 'already_terminated');
});

/* ------------------------------------------ giving up on a silent trip -- */

const silentTrip = (over = {}) => ({
  status: 'in_transit',
  plan,
  scheduledDeparture: minutesAgo(60 * 20),
  actualDeparture: minutesAgo(60 * 20),
  lastConfirmedAt: minutesAgo(60 * 19),
  abandonedAt: null,
  ...over,
});

test('a trip is only given up on when it is both overdue and silent', () => {
  assert.equal(isAbandoned(silentTrip()), true);

  // Heard from recently: still running, however overdue.
  assert.equal(isAbandoned(silentTrip({ lastConfirmedAt: minutesAgo(30) })), false);

  // Silent, but not yet past when it was due to finish.
  assert.equal(
    isAbandoned(
      silentTrip({
        scheduledDeparture: minutesAgo(60),
        actualDeparture: minutesAgo(60),
        lastConfirmedAt: minutesAgo(60),
      })
    ),
    false
  );

  // Not running, or already closed.
  assert.equal(isAbandoned(silentTrip({ status: 'arrived' })), false);
  assert.equal(isAbandoned(silentTrip({ status: 'scheduled' })), false);
  assert.equal(isAbandoned(silentTrip({ abandonedAt: new Date() })), false);
});

test('the threshold is measured from its own expected arrival, not its departure', () => {
  // A 140-minute run that left 9 hours ago is 6h40m overdue: closed.
  const longGone = silentTrip({
    scheduledDeparture: minutesAgo(60 * 9),
    actualDeparture: minutesAgo(60 * 9),
    lastConfirmedAt: minutesAgo(60 * 9),
  });
  assert.equal(isAbandoned(longGone), true);

  // The same trip 7 hours ago is only 4h40m overdue — still silent, but not
  // yet long enough past the arrival it was working towards.
  const stillSilent = silentTrip({
    scheduledDeparture: minutesAgo(60 * 7),
    actualDeparture: minutesAgo(60 * 7),
    lastConfirmedAt: minutesAgo(60 * 7),
  });
  assert.equal(isAbandoned(stillSilent), false);
  assert.equal(SILENT_FOR_HOURS * HOUR > 0, true);
});

/* ------------------------------------------------------------ through the API -- */

let mongod;
let app;
let models;
let w;

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
  for (const name of ['PITX', 'Alabang', 'Lipa']) {
    cps.push((await asAdmin(request(app).post('/api/admin/checkpoints')).send({ name, type: 'station' })).body);
  }
  const route = await asAdmin(request(app).post('/api/admin/routes')).send({
    name: 'PITX – Lipa',
    checkpoints: [
      { checkpoint: cps[0]._id, baselineMinutesFromPrevious: 0 },
      { checkpoint: cps[1]._id, baselineMinutesFromPrevious: 40 },
      { checkpoint: cps[2]._id, baselineMinutesFromPrevious: 80 },
    ],
  });
  const bus = await asAdmin(request(app).post('/api/admin/buses')).send({
    plateNumber: 'SBL 1174',
    operatorName: 'Southbound Lines',
  });
  const conductor = await asAdmin(request(app).post('/api/admin/conductors')).send({
    name: 'Dennis Aguilar',
    username: 'dennis',
    password: 'checkpoint123',
  });
  await models.User.updateOne({ username: 'dennis' }, { mustChangePassword: false });
  const trip = await asAdmin(request(app).post('/api/admin/trips')).send({
    routeId: route.body._id,
    busId: bus.body._id,
    conductorId: conductor.body._id,
    scheduledDeparture: minutesAgo(60).toISOString(),
  });
  const conductorToken = (
    await request(app).post('/api/auth/login').send({ username: 'dennis', password: 'checkpoint123' })
  ).body.token;

  w = {
    asAdmin,
    asConductor: (req) => req.set('Authorization', `Bearer ${conductorToken}`),
    tripId: trip.body.trip.id,
    pitx: cps[0]._id,
    alabang: cps[1]._id,
    lipa: cps[2]._id,
  };
});

const tap = (body) =>
  w
    .asConductor(request(app).post(`/api/conductor/trips/${w.tripId}/checkpoint-logs`))
    .send({ clientLogId: `tap-${Math.random()}`, ...body })
    .expect(201);

const board = async (stationId) =>
  (await request(app).get(`/api/public/stations/${stationId}/board`).expect(200)).body.arrivals;

test('a conductor can report that the bus cannot continue, and stops down the line are told', async () => {
  await tap({ type: 'departed', reportedAt: minutesAgo(60).toISOString() });
  await tap({ type: 'passed_checkpoint', checkpoint: w.alabang, reportedAt: minutesAgo(18).toISOString() });
  await tap({ type: 'terminated', delayReason: 'breakdown', reportedAt: minutesAgo(5).toISOString() });

  const [row] = await board(w.lipa);
  assert.equal(row.boardKind, 'cancelled');
  assert.equal(row.terminated.reason, 'breakdown');
  assert.equal(row.terminated.nearCheckpoint, 'Alabang');
  assert.equal(row.eta, null, 'no arrival time is offered for a bus that is not coming');

  // The stop it had already reached is not told to stop waiting for it.
  assert.deepEqual(await board(w.alabang), []);
});

test('the cancellation notice does not linger for ever', async () => {
  await tap({ type: 'departed', reportedAt: minutesAgo(200).toISOString() });
  await tap({ type: 'terminated', delayReason: 'breakdown', reportedAt: minutesAgo(90).toISOString() });

  assert.deepEqual(await board(w.lipa), [], 'an hour and a half later it is simply gone');
});

test('a trip an operator cancels before it leaves says so on the board it would have left from', async () => {
  await w.asAdmin(request(app).put(`/api/admin/trips/${w.tripId}`)).send({ status: 'cancelled' }).expect(200);

  const [row] = await board(w.pitx);
  assert.equal(row.boardKind, 'cancelled');
  assert.equal(row.terminated, null, 'nobody reported a reason; none is invented');
});

test('a trip that goes silent is closed, drops off the board, and comes back if it reports', async () => {
  await tap({ type: 'departed', reportedAt: minutesAgo(60 * 9).toISOString() });
  await models.Trip.updateOne(
    { _id: w.tripId },
    { scheduledDeparture: minutesAgo(60 * 9), lastConfirmedAt: minutesAgo(60 * 9) }
  );

  assert.equal(await closeAbandonedTrips(), 1);
  assert.ok((await models.Trip.findById(w.tripId)).abandonedAt);
  assert.deepEqual(await board(w.lipa), []);

  // It was out of signal, not gone. A tap that finally lands reopens it.
  await tap({ type: 'passed_checkpoint', checkpoint: w.alabang, reportedAt: minutesAgo(3).toISOString() });
  assert.equal((await models.Trip.findById(w.tripId)).abandonedAt, null);
  assert.equal((await board(w.lipa)).length, 1);
});

test('a trip still reporting is never closed', async () => {
  await tap({ type: 'departed', reportedAt: minutesAgo(60 * 9).toISOString() });
  await tap({ type: 'passed_checkpoint', checkpoint: w.alabang, reportedAt: minutesAgo(10).toISOString() });
  await models.Trip.updateOne({ _id: w.tripId }, { scheduledDeparture: minutesAgo(60 * 9) });

  assert.equal(await closeAbandonedTrips(), 0);
});
