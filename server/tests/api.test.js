import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.JWT_SECRET = 'test-secret-not-used-anywhere-real';

const { createApp } = await import('../app.js');
const { Bus, Checkpoint, Route, Trip, User } = await import('../models/index.js');

let mongod;
let app;

const minutesAgo = (m) => new Date(Date.now() - m * 60000).toISOString();

before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  app = createApp();
});

after(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

/** Build the Cubao – Baguio world through the admin API, as an operator would. */
async function setupWorld() {
  await Promise.all([
    Trip.deleteMany({}),
    Route.deleteMany({}),
    Checkpoint.deleteMany({}),
    Bus.deleteMany({}),
    User.deleteMany({}),
    mongoose.connection.collection('checkpointlogs').deleteMany({}),
  ]);

  await User.create({
    name: 'Ops Admin',
    username: 'admin',
    role: 'admin',
    passwordHash: await User.hashPassword('checkpoint123'),
  });

  const adminLogin = await request(app)
    .post('/api/auth/login')
    .send({ username: 'admin', password: 'checkpoint123' })
    .expect(200);
  const adminToken = adminLogin.body.token;
  const asAdmin = (req) => req.set('Authorization', `Bearer ${adminToken}`);

  const specs = [
    { name: 'Cubao Terminal', type: 'station', isTerminal: true },
    { name: 'Balintawak', type: 'station' },
    { name: 'Tarlac stop', type: 'station' },
    { name: 'TPLEX – Rosario Exit', type: 'landmark' },
    { name: 'Baguio Terminal', type: 'station', isTerminal: true },
  ];
  const cps = [];
  for (const spec of specs) {
    const res = await asAdmin(request(app).post('/api/admin/checkpoints')).send(spec).expect(201);
    cps.push(res.body);
  }

  const baselines = [0, 20, 80, 40, 45];
  const route = await asAdmin(request(app).post('/api/admin/routes'))
    .send({
      name: 'Cubao – Baguio',
      checkpoints: cps.map((cp, i) => ({
        checkpoint: cp._id,
        baselineMinutesFromPrevious: baselines[i],
      })),
    })
    .expect(201);

  const bus = await asAdmin(request(app).post('/api/admin/buses'))
    .send({ plateNumber: 'NRT 8821', operatorName: 'Northline Express' })
    .expect(201);

  const conductor = await asAdmin(request(app).post('/api/admin/conductors'))
    .send({ name: 'Rey Santiago', username: 'rey', password: 'checkpoint123' })
    .expect(201);

  const trip = await asAdmin(request(app).post('/api/admin/trips'))
    .send({
      routeId: route.body._id,
      busId: bus.body._id,
      conductorId: conductor.body._id,
      scheduledDeparture: minutesAgo(0),
    })
    .expect(201);

  const conductorLogin = await request(app)
    .post('/api/auth/login')
    .send({ username: 'rey', password: 'checkpoint123' })
    .expect(200);

  return {
    adminToken,
    conductorToken: conductorLogin.body.token,
    cps,
    route: route.body,
    trip: trip.body.trip,
  };
}

const byName = (cps, name) => cps.find((c) => c.name === name)._id;

test('one login serves both roles, and the token still fences them apart', async () => {
  const { conductorToken } = await setupWorld();

  // Both staff roles sign in through the same endpoint; the response says which
  // product the person belongs in.
  const asConductor = await request(app)
    .post('/api/auth/login')
    .send({ username: 'rey', password: 'checkpoint123' })
    .expect(200);
  assert.equal(asConductor.body.user.role, 'conductor');

  const asAdmin = await request(app)
    .post('/api/auth/login')
    .send({ username: 'admin', password: 'checkpoint123' })
    .expect(200);
  assert.equal(asAdmin.body.user.role, 'admin');

  await request(app)
    .post('/api/auth/login')
    .send({ username: 'rey', password: 'wrong-password' })
    .expect(401);

  // Sharing a door changes nothing about authorisation: a conductor token must
  // still be refused everywhere admin is required.
  await request(app)
    .get('/api/admin/dashboard')
    .set('Authorization', `Bearer ${conductorToken}`)
    .expect(403);

  await request(app).get('/api/admin/dashboard').expect(401);
});

test('the public board needs no token at all', async () => {
  await setupWorld();

  const stations = await request(app).get('/api/public/stations').expect(200);
  // Landmarks are timing points and must never appear as a boardable station.
  assert.equal(stations.body.some((s) => s.name.includes('TPLEX')), false);
  assert.equal(stations.body.length, 4);

  await request(app).get('/api/public/routes').expect(200);
  await request(app).get('/api/public/trips').expect(200);
});

test('a trip freezes its own plan, so editing the route later cannot move it', async () => {
  const { adminToken, route, trip, cps } = await setupWorld();

  await request(app)
    .put(`/api/admin/routes/${route._id}`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      name: 'Cubao – Baguio',
      checkpoints: cps.map((cp, i) => ({
        checkpoint: cp._id,
        baselineMinutesFromPrevious: [0, 200, 200, 200, 200][i],
      })),
    })
    .expect(200);

  const after = await request(app).get(`/api/public/trips/${trip.id}`).expect(200);
  const baselines = after.body.trip.stops.map((s) => s.baselineMinutesFromPrevious);
  assert.deepEqual(baselines, [0, 20, 80, 40, 45]);
});

test('a scheduled trip persists with no projections rather than inventing them', async () => {
  const { trip } = await setupWorld();
  const { recomputeTrip } = await import('../services/tripService.js');

  // Recomputing a trip that has not departed must be a clean no-op, not a
  // validation failure or a set of fabricated times.
  await recomputeTrip(trip.id);

  const res = await request(app).get(`/api/public/trips/${trip.id}`).expect(200);
  assert.equal(res.body.trip.status, 'scheduled');
  assert.equal(res.body.trip.stops.every((s) => s.projectedArrival === null), true);
});

test('end to end: depart, confirm a checkpoint late, and see it on the board', async () => {
  const { conductorToken, cps, trip } = await setupWorld();
  const asConductor = (req) => req.set('Authorization', `Bearer ${conductorToken}`);

  const mine = await asConductor(request(app).get('/api/conductor/trips')).expect(200);
  assert.equal(mine.body.trips.length, 1);
  assert.equal(mine.body.trips[0].status, 'scheduled');

  await asConductor(request(app).post(`/api/conductor/trips/${trip.id}/checkpoint-logs`))
    .send({ type: 'departed', reportedAt: minutesAgo(35), clientLogId: 'c1' })
    .expect(201);

  // Balintawak baseline is 20 minutes; confirmed at 35. Fifteen minutes late.
  const afterCheckpoint = await asConductor(
    request(app).post(`/api/conductor/trips/${trip.id}/checkpoint-logs`)
  )
    .send({
      type: 'passed_checkpoint',
      checkpoint: byName(cps, 'Balintawak'),
      reportedAt: minutesAgo(0),
      clientLogId: 'c2',
    })
    .expect(201);

  assert.equal(afterCheckpoint.body.trip.varianceMinutes, 15);
  assert.equal(afterCheckpoint.body.trip.status, 'delayed');

  // The variance must be visible to a guest, on the right station's board.
  const board = await request(app)
    .get(`/api/public/stations/${byName(cps, 'Baguio Terminal')}/board`)
    .expect(200);

  assert.equal(board.body.arrivals.length, 1);
  const arrival = board.body.arrivals[0];
  assert.equal(arrival.status, 'delayed');
  assert.equal(arrival.varianceMinutes, 15);
  assert.equal(arrival.lastConfirmedCheckpoint.name, 'Balintawak');
  assert.ok(arrival.eta, 'the board must carry an ETA');

  // Confirming a station means the bus has *reached* it, so it is standing
  // there and must stay on that station's own board until it reports leaving.
  const balintawakBoard = await request(app)
    .get(`/api/public/stations/${byName(cps, 'Balintawak')}/board`)
    .expect(200);
  assert.equal(balintawakBoard.body.arrivals.length, 1);
  assert.equal(balintawakBoard.body.arrivals[0].isHereNow, true);
});

test('a queue drained out of order lands on the correct state', async () => {
  const { conductorToken, cps, trip } = await setupWorld();
  const asConductor = (req) => req.set('Authorization', `Bearer ${conductorToken}`);

  // Everything the device buffered through a dead zone, posted in the wrong
  // order and including one duplicate the phone retried.
  const res = await asConductor(
    request(app).post(`/api/conductor/trips/${trip.id}/checkpoint-logs/sync`)
  )
    .send({
      logs: [
        {
          type: 'passed_checkpoint',
          checkpoint: byName(cps, 'Tarlac stop'),
          reportedAt: minutesAgo(45),
          clientLogId: 'q3',
        },
        { type: 'departed', reportedAt: minutesAgo(150), clientLogId: 'q1' },
        { type: 'delayed', delayReason: 'traffic', reportedAt: minutesAgo(20), clientLogId: 'q4' },
        {
          type: 'passed_checkpoint',
          checkpoint: byName(cps, 'Balintawak'),
          reportedAt: minutesAgo(125),
          clientLogId: 'q2',
        },
      ],
    })
    .expect(200);

  // Departed 150 min ago, Tarlac confirmed at 105 min against a 100 min
  // baseline: five minutes late, regardless of arrival order.
  assert.equal(res.body.accepted, 4);
  assert.equal(res.body.trip.varianceMinutes, 5);
  assert.equal(res.body.trip.lastConfirmedCheckpoint.name, 'Tarlac stop');
  assert.equal(res.body.trip.latestDelay.reason, 'traffic');
  assert.deepEqual(res.body.ignored, []);

  // Re-sending the same queue is safe — the idempotency keys absorb it.
  const replay = await asConductor(
    request(app).post(`/api/conductor/trips/${trip.id}/checkpoint-logs/sync`)
  )
    .send({
      logs: [{ type: 'departed', reportedAt: minutesAgo(150), clientLogId: 'q1' }],
    })
    .expect(200);
  assert.equal(replay.body.trip.varianceMinutes, 5);
});

test('a trip that stops reporting is flagged stale on the public board', async () => {
  const { conductorToken, cps, trip } = await setupWorld();
  const asConductor = (req) => req.set('Authorization', `Bearer ${conductorToken}`);

  // Confirmed Tarlac 95 minutes ago. The next segment is 40 minutes, so the
  // grace window closed 35 minutes back.
  await asConductor(request(app).post(`/api/conductor/trips/${trip.id}/checkpoint-logs/sync`))
    .send({
      logs: [
        { type: 'departed', reportedAt: minutesAgo(200), clientLogId: 's1' },
        {
          type: 'passed_checkpoint',
          checkpoint: byName(cps, 'Tarlac stop'),
          reportedAt: minutesAgo(95),
          clientLogId: 's2',
        },
      ],
    })
    .expect(200);

  const board = await request(app)
    .get(`/api/public/stations/${byName(cps, 'Baguio Terminal')}/board`)
    .expect(200);

  const arrival = board.body.arrivals[0];
  assert.equal(arrival.isStale, true);
  assert.equal(arrival.minutesSinceLastConfirm >= 94, true);
});

test('a conductor cannot log against a trip that is not theirs', async () => {
  const { adminToken, trip } = await setupWorld();

  await request(app)
    .post('/api/admin/conductors')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: 'Marlon Cruz', username: 'marlon', password: 'checkpoint123' })
    .expect(201);

  const other = await request(app)
    .post('/api/auth/login')
    .send({ username: 'marlon', password: 'checkpoint123' })
    .expect(200);

  await request(app)
    .post(`/api/conductor/trips/${trip.id}/checkpoint-logs`)
    .set('Authorization', `Bearer ${other.body.token}`)
    .send({ type: 'departed', reportedAt: minutesAgo(5), clientLogId: 'x1' })
    .expect(404);

  const mine = await request(app)
    .get('/api/conductor/trips')
    .set('Authorization', `Bearer ${other.body.token}`)
    .expect(200);
  assert.equal(mine.body.trips.length, 0);
});

test('arriving closes the trip and clears it from the board', async () => {
  const { conductorToken, cps, trip } = await setupWorld();
  const asConductor = (req) => req.set('Authorization', `Bearer ${conductorToken}`);

  await asConductor(request(app).post(`/api/conductor/trips/${trip.id}/checkpoint-logs/sync`))
    .send({
      logs: [
        { type: 'departed', reportedAt: minutesAgo(195), clientLogId: 'a1' },
        { type: 'arrived', reportedAt: minutesAgo(5), clientLogId: 'a2' },
      ],
    })
    .expect(200);

  const detail = await request(app).get(`/api/public/trips/${trip.id}`).expect(200);
  assert.equal(detail.body.trip.status, 'arrived');
  assert.equal(detail.body.trip.varianceMinutes, 5); // 190 actual vs 185 baseline
  assert.equal(detail.body.trip.isStale, false);

  // It has just got in, so it stays on the destination board as arrived —
  // it is still on the stand, and someone meeting it needs to see that.
  const board = await request(app)
    .get(`/api/public/stations/${byName(cps, 'Baguio Terminal')}/board`)
    .expect(200);
  assert.equal(board.body.arrivals.length, 1);
  assert.equal(board.body.arrivals[0].boardKind, 'arrived');

  // But it is no longer inbound anywhere it has already been.
  const behind = await request(app)
    .get(`/api/public/stations/${byName(cps, 'Balintawak')}/board`)
    .expect(200);
  assert.equal(behind.body.arrivals.length, 0);
});

test('a conductor can take back a mistaken tap, and the trip recomputes', async () => {
  const { conductorToken, cps, trip } = await setupWorld();
  const asConductor = (req) => req.set('Authorization', `Bearer ${conductorToken}`);

  await asConductor(request(app).post(`/api/conductor/trips/${trip.id}/checkpoint-logs`))
    .send({ type: 'departed', reportedAt: minutesAgo(35), clientLogId: 'u1' })
    .expect(201);

  // The wrong button: confirms a checkpoint the bus has not reached.
  const wrong = await asConductor(
    request(app).post(`/api/conductor/trips/${trip.id}/checkpoint-logs`)
  )
    .send({
      type: 'passed_checkpoint',
      checkpoint: byName(cps, 'Tarlac stop'),
      reportedAt: minutesAgo(0),
      clientLogId: 'u2',
    })
    .expect(201);
  assert.equal(wrong.body.trip.lastConfirmedCheckpoint.name, 'Tarlac stop');

  const undone = await asConductor(
    request(app).delete(`/api/conductor/trips/${trip.id}/checkpoint-logs/u2`)
  ).expect(200);

  // Replaying without that log must leave no trace of it: not in the position,
  // not in the variance, not in the skipped-checkpoint marks.
  assert.equal(undone.body.trip.lastConfirmedCheckpoint.name, 'Cubao Terminal');
  assert.equal(undone.body.trip.varianceMinutes, 0);
  assert.equal(undone.body.trip.stops.every((s) => s.progress !== 'skipped'), true);

  // Gone for good — a second undo has nothing to remove.
  await asConductor(
    request(app).delete(`/api/conductor/trips/${trip.id}/checkpoint-logs/u2`)
  ).expect(404);
});

test('undo is refused once the update is no longer recent', async () => {
  const { conductorToken, trip } = await setupWorld();
  const asConductor = (req) => req.set('Authorization', `Bearer ${conductorToken}`);

  await asConductor(request(app).post(`/api/conductor/trips/${trip.id}/checkpoint-logs/sync`))
    .send({ logs: [{ type: 'departed', reportedAt: minutesAgo(90), clientLogId: 'old1' }] })
    .expect(200);

  // Passengers have been reading this for an hour and a half; it is history now.
  const res = await asConductor(
    request(app).delete(`/api/conductor/trips/${trip.id}/checkpoint-logs/old1`)
  ).expect(409);
  assert.match(res.body.error, /within 5 minutes/);
});

test('one conductor cannot undo another conductor trip update', async () => {
  const { adminToken, conductorToken, trip } = await setupWorld();
  const asConductor = (req) => req.set('Authorization', `Bearer ${conductorToken}`);

  await asConductor(request(app).post(`/api/conductor/trips/${trip.id}/checkpoint-logs`))
    .send({ type: 'departed', reportedAt: minutesAgo(2), clientLogId: 'mine' })
    .expect(201);

  await request(app)
    .post('/api/admin/conductors')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: 'Marlon Cruz', username: 'marlon', password: 'checkpoint123' })
    .expect(201);

  const other = await request(app)
    .post('/api/auth/login')
    .send({ username: 'marlon', password: 'checkpoint123' })
    .expect(200);

  await request(app)
    .delete(`/api/conductor/trips/${trip.id}/checkpoint-logs/mine`)
    .set('Authorization', `Bearer ${other.body.token}`)
    .expect(404);
});

test('a bus standing at a stop stays on that stop board, first', async () => {
  const { conductorToken, cps, trip } = await setupWorld();
  const asConductor = (req) => req.set('Authorization', `Bearer ${conductorToken}`);

  await asConductor(request(app).post(`/api/conductor/trips/${trip.id}/checkpoint-logs/sync`))
    .send({
      logs: [
        { type: 'departed', reportedAt: minutesAgo(35), clientLogId: 'p1' },
        {
          type: 'passed_checkpoint',
          checkpoint: byName(cps, 'Balintawak'),
          reportedAt: minutesAgo(3),
          clientLogId: 'p2',
        },
      ],
    })
    .expect(200);

  // Someone waiting at Balintawak must still see the bus that is sitting there.
  const here = await request(app)
    .get(`/api/public/stations/${byName(cps, 'Balintawak')}/board`)
    .expect(200);

  assert.equal(here.body.arrivals.length, 1);
  assert.equal(here.body.arrivals[0].isHereNow, true);
  assert.equal(here.body.arrivals[0].position, 'at_stop');

  // Once the conductor reports pulling out, it leaves that board.
  await asConductor(request(app).post(`/api/conductor/trips/${trip.id}/checkpoint-logs`))
    .send({
      type: 'left_checkpoint',
      checkpoint: byName(cps, 'Balintawak'),
      reportedAt: minutesAgo(0),
      clientLogId: 'p3',
    })
    .expect(201);

  const gone = await request(app)
    .get(`/api/public/stations/${byName(cps, 'Balintawak')}/board`)
    .expect(200);
  assert.equal(gone.body.arrivals.length, 0);

  // And downstream it now reads as on the road, not parked.
  const ahead = await request(app)
    .get(`/api/public/stations/${byName(cps, 'Baguio Terminal')}/board`)
    .expect(200);
  assert.equal(ahead.body.arrivals[0].position, 'between');
  assert.equal(ahead.body.arrivals[0].isHereNow, false);
});

test('a terminal board shows what is leaving, what is coming, and what just got in', async () => {
  const { adminToken, conductorToken, cps, trip, route } = await setupWorld();
  const asConductor = (req) => req.set('Authorization', `Bearer ${conductorToken}`);
  const cubao = byName(cps, 'Cubao Terminal');
  const baguio = byName(cps, 'Baguio Terminal');

  // The seeded trip has not departed, so at its origin it is a departure —
  // not an "arrival" at the terminal it is parked in.
  const origin = await request(app).get(`/api/public/stations/${cubao}/board`).expect(200);
  assert.equal(origin.body.arrivals.length, 1);
  assert.equal(origin.body.arrivals[0].boardKind, 'departure');

  // Run it to completion.
  await asConductor(request(app).post(`/api/conductor/trips/${trip.id}/checkpoint-logs/sync`))
    .send({
      logs: [
        { type: 'departed', reportedAt: minutesAgo(190), clientLogId: 'k1' },
        { type: 'arrived', reportedAt: minutesAgo(4), clientLogId: 'k2' },
      ],
    })
    .expect(200);

  // It is parked at Baguio, and someone meeting it needs to see that.
  const dest = await request(app).get(`/api/public/stations/${baguio}/board`).expect(200);
  assert.equal(dest.body.arrivals.length, 1);
  assert.equal(dest.body.arrivals[0].boardKind, 'arrived');
  assert.ok(dest.body.arrivals[0].boardTime, 'an arrived bus still needs a time');

  // It no longer counts as inbound at a stop it never reaches again.
  const origin2 = await request(app).get(`/api/public/stations/${cubao}/board`).expect(200);
  assert.equal(origin2.body.arrivals.length, 0);
});

test('a bus that finished long ago is not still on the stand', async () => {
  const { conductorToken, cps, trip } = await setupWorld();
  const asConductor = (req) => req.set('Authorization', `Bearer ${conductorToken}`);

  await asConductor(request(app).post(`/api/conductor/trips/${trip.id}/checkpoint-logs/sync`))
    .send({
      logs: [
        { type: 'departed', reportedAt: minutesAgo(400), clientLogId: 'o1' },
        // Over the 45-minute window: long gone from the terminal.
        { type: 'arrived', reportedAt: minutesAgo(120), clientLogId: 'o2' },
      ],
    })
    .expect(200);

  const board = await request(app)
    .get(`/api/public/stations/${byName(cps, 'Baguio Terminal')}/board`)
    .expect(200);
  assert.equal(board.body.arrivals.length, 0);
});

/* ------------------------------------------------------------------- setup */

test('a fresh system can create its first admin, once', async () => {
  await Promise.all([Trip.deleteMany({}), User.deleteMany({})]);
  delete process.env.SETUP_TOKEN;

  const before = await request(app).get('/api/auth/setup-status').expect(200);
  assert.equal(before.body.needsSetup, true);

  const created = await request(app)
    .post('/api/auth/setup')
    .send({ name: 'First Admin', username: 'firstadmin', password: 'a-long-enough-pass' })
    .expect(201);

  // Signed in immediately — otherwise the next step is a login form for an
  // account that was created a second ago, which is pointless friction.
  assert.equal(created.body.user.role, 'admin');
  assert.ok(created.body.token);

  await request(app)
    .get('/api/admin/dashboard')
    .set('Authorization', `Bearer ${created.body.token}`)
    .expect(200);

  // And it closes behind itself, so it can never become a back door.
  const after = await request(app).get('/api/auth/setup-status').expect(200);
  assert.equal(after.body.needsSetup, false);

  await request(app)
    .post('/api/auth/setup')
    .send({ name: 'Sneaky', username: 'sneaky', password: 'a-long-enough-pass' })
    .expect(409);
});

test('a setup token is enforced when one is configured', async () => {
  await Promise.all([Trip.deleteMany({}), User.deleteMany({})]);
  process.env.SETUP_TOKEN = 'the-right-token';

  const status = await request(app).get('/api/auth/setup-status').expect(200);
  assert.equal(status.body.requiresToken, true);

  await request(app)
    .post('/api/auth/setup')
    .send({ name: 'X', username: 'x', password: 'a-long-enough-pass', token: 'guess' })
    .expect(403);

  await request(app)
    .post('/api/auth/setup')
    .send({
      name: 'Ops',
      username: 'ops',
      password: 'a-long-enough-pass',
      token: 'the-right-token',
    })
    .expect(201);

  delete process.env.SETUP_TOKEN;
});

test('admins can appoint a successor, and cannot delete the last one', async () => {
  const { adminToken } = await setupWorld();
  const asAdmin = (req) => req.set('Authorization', `Bearer ${adminToken}`);

  const only = await asAdmin(request(app).get('/api/admin/admins')).expect(200);
  assert.equal(only.body.length, 1);

  // The lone admin cannot be removed — that would lock everyone out for good.
  await asAdmin(request(app).delete(`/api/admin/admins/${only.body[0]._id}`)).expect(409);

  const second = await asAdmin(request(app).post('/api/admin/admins'))
    .send({ name: 'Second Admin', username: 'second', password: 'a-long-enough-pass' })
    .expect(201);

  // A second admin can genuinely sign in, so this is real succession.
  const login = await request(app)
    .post('/api/auth/login')
    .send({ username: 'second', password: 'a-long-enough-pass' })
    .expect(200);
  assert.equal(login.body.user.role, 'admin');

  // Now that a successor exists, the other can go — but never yourself.
  await asAdmin(request(app).delete(`/api/admin/admins/${second.body._id}`)).expect(204);
});

test('route legs can be estimated, and the operator can still override them', async () => {
  const { adminToken, cps } = await setupWorld();
  const asAdmin = (req) => req.set('Authorization', `Bearer ${adminToken}`);

  // No provider configured in tests, so this must fail clearly rather than
  // silently handing back invented numbers.
  const withoutKey = await asAdmin(request(app).post('/api/admin/routes/measure'))
    .send({ checkpointIds: [byName(cps, 'Cubao Terminal'), byName(cps, 'Balintawak')] })
    .expect(503);
  assert.match(withoutKey.body.error, /traffic provider/i);

  // With a provider present, too few stops is a plain input error. (Without
  // one, availability is reported first — there is no point validating input
  // for a feature that cannot run.)
  process.env.TRAFFIC_API_KEY = 'test-key-never-called';
  try {
    await asAdmin(request(app).post('/api/admin/routes/measure'))
      .send({ checkpointIds: [byName(cps, 'Cubao Terminal')] })
      .expect(400);
  } finally {
    delete process.env.TRAFFIC_API_KEY;
  }

  // Whatever is suggested, the route is saved from what the operator submits —
  // an estimate is a starting point, never the stored value.
  const route = await asAdmin(request(app).post('/api/admin/routes'))
    .send({
      name: 'Operator-corrected route',
      checkpoints: [
        { checkpoint: byName(cps, 'Cubao Terminal'), baselineMinutesFromPrevious: 0 },
        { checkpoint: byName(cps, 'Balintawak'), baselineMinutesFromPrevious: 99 },
      ],
    })
    .expect(201);

  assert.equal(route.body.checkpoints[1].baselineMinutesFromPrevious, 99);
});
