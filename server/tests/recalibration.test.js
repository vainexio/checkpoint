import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { calibrate, legSamples, MIN_SAMPLES } from '../services/recalibration.js';

process.env.JWT_SECRET = 'test-secret-not-used-anywhere-real';

/* A → B → C, with the operator's figures: 40 off-peak, 60 off-peak. */
const route = {
  checkpoints: [
    { checkpoint: { _id: 'a', name: 'PITX' }, baselineMinutesFromPrevious: 0 },
    { checkpoint: { _id: 'b', name: 'Alabang' }, baselineMinutesFromPrevious: 40 },
    { checkpoint: { _id: 'c', name: 'Turbina' }, baselineMinutesFromPrevious: 60 },
  ],
};

/** A finished trip that left at `hhmm` Manila and drove the legs given. */
const trip = (hhmm, legMinutes, day = '2026-09-10') => {
  const start = new Date(`${day}T${hhmm}:00+08:00`);
  const at = (mins) => new Date(start.getTime() + mins * 60000).toISOString();
  let elapsed = 0;
  const stops = [{ checkpoint: 'a', progress: 'passed', actualArrival: at(0) }];
  for (const [i, minutes] of legMinutes.entries()) {
    elapsed += minutes;
    stops.push({ checkpoint: 'abc'[i + 1], progress: 'passed', actualArrival: at(elapsed) });
  }
  return { computedETAs: stops };
};

/* ------------------------------------------------------------ what a trip says -- */

test('a leg is measured from one confirmation to the next, the way the engine measures it', () => {
  const samples = legSamples(trip('11:00', [44, 58]));
  assert.deepEqual(
    samples.map((s) => [s.from, s.to, s.minutes, s.band]),
    [
      ['a', 'b', 44, 'offPeak'],
      ['b', 'c', 58, 'offPeak'],
    ]
  );
});

test('a leg driven into the evening rush is filed under the evening rush', () => {
  // Leaves 16:30, so the first leg is off-peak and the second starts at 17:14.
  const samples = legSamples(trip('16:30', [44, 58]));
  assert.deepEqual(samples.map((s) => s.band), ['offPeak', 'pmPeak']);
});

test('a checkpoint nobody confirmed measures nothing, rather than a guess', () => {
  const skipped = trip('11:00', [44, 58]);
  skipped.computedETAs[1] = { checkpoint: 'b', progress: 'skipped', actualArrival: null };

  // Neither the leg into it nor the leg out of it can be measured — and the
  // two are emphatically not merged into one 102-minute sample.
  assert.deepEqual(legSamples(skipped), []);
});

/* ------------------------------------------------------------- what to suggest -- */

const many = (n, minutes, hhmm = '11:00') =>
  Array.from({ length: n }, (_, i) => trip(hhmm, minutes, `2026-09-${String(10 + i).padStart(2, '0')}`));

test('enough trips that agree become a suggestion', () => {
  const { legs, suggestions } = calibrate(route, many(6, [44, 58]));

  const first = legs[0].bands.find((b) => b.band === 'offPeak');
  assert.equal(first.samples, 6);
  assert.equal(first.currentMinutes, 40);
  assert.equal(first.measuredMinutes, 44);
  assert.equal(first.deltaMinutes, 4);
  assert.equal(first.worthChanging, true);

  // The second leg runs two minutes *under* its baseline, which is below the
  // threshold: real, but not worth an operator's attention.
  const second = legs[1].bands.find((b) => b.band === 'offPeak');
  assert.equal(second.deltaMinutes, -2);
  assert.equal(second.worthChanging, true);
  assert.equal(suggestions, 2);
});

test('a handful of trips cannot outvote the operator', () => {
  const { legs, suggestions } = calibrate(route, many(MIN_SAMPLES - 1, [55, 80]));
  assert.equal(legs[0].bands[0].samples, MIN_SAMPLES - 1);
  assert.equal(legs[0].bands[0].worthChanging, false, 'measured, reported, but not urged');
  assert.equal(suggestions, 0);
});

test('one bus that broke down does not move the answer', () => {
  const trips = [...many(6, [44, 58]), trip('11:00', [400, 58], '2026-09-20')];
  const first = calibrate(route, trips).legs[0].bands[0];

  assert.equal(first.measuredMinutes, 44);
  assert.equal(first.discarded, 1, 'four times the baseline is not a measurement of this leg');
});

test('the spread is reported, so a operator can see how much the road varies', () => {
  const trips = [
    ...many(3, [40, 58]),
    ...many(3, [50, 58], '11:30'),
  ];
  const first = calibrate(route, trips).legs[0].bands[0];
  assert.ok(first.spread.lowMinutes <= first.measuredMinutes);
  assert.ok(first.spread.highMinutes >= first.measuredMinutes);
});

test('rush-hour trips calibrate the rush-hour figure, not the all-day one', () => {
  // Six evening runs: the first leg starts at 17:30 every time.
  const evening = many(6, [55, 58], '17:30');
  const { legs } = calibrate(route, evening);

  const pm = legs[0].bands.find((b) => b.band === 'pmPeak');
  assert.equal(pm.samples, 6);
  assert.equal(pm.measuredMinutes, 55);
  // No rush-hour figure is set, so it is judged against the number actually
  // used at that hour: the all-day one.
  assert.equal(pm.currentMinutes, 40);
  assert.equal(pm.worthChanging, true);

  // And the all-day figure is untouched by them.
  assert.equal(legs[0].bands.some((b) => b.band === 'offPeak'), false);
});

/* ------------------------------------------------------------ through the API -- */

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

let world;

beforeEach(async () => {
  for (const model of Object.values(models)) await model.deleteMany({});
  await models.User.create({
    name: 'Ops Admin',
    username: 'admin',
    role: 'admin',
    passwordHash: await models.User.hashPassword('checkpoint123'),
  });
  const token = (
    await request(app).post('/api/auth/login').send({ username: 'admin', password: 'checkpoint123' })
  ).body.token;
  const as = (req) => req.set('Authorization', `Bearer ${token}`);

  const cps = [];
  for (const name of ['PITX', 'Alabang', 'Turbina']) {
    cps.push((await as(request(app).post('/api/admin/checkpoints')).send({ name, type: 'station' })).body);
  }
  const created = await as(request(app).post('/api/admin/routes')).send({
    name: 'PITX – Turbina',
    checkpoints: [
      { checkpoint: cps[0]._id, baselineMinutesFromPrevious: 0 },
      { checkpoint: cps[1]._id, baselineMinutesFromPrevious: 40 },
      { checkpoint: cps[2]._id, baselineMinutesFromPrevious: 60 },
    ],
  });
  world = { as, routeId: created.body._id, cps };
});

/** A finished trip on the real route, driving each leg in the minutes given. */
async function ranTrip(daysAgo, legMinutes) {
  const start = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  // 11:00 Manila on that day, so every sample lands off-peak.
  start.setUTCHours(3, 0, 0, 0);
  const at = (mins) => new Date(start.getTime() + mins * 60000);

  let elapsed = 0;
  const stops = [{ checkpoint: world.cps[0]._id, progress: 'passed', actualArrival: at(0) }];
  for (const [i, minutes] of legMinutes.entries()) {
    elapsed += minutes;
    stops.push({
      checkpoint: world.cps[i + 1]._id,
      progress: 'passed',
      actualArrival: at(elapsed),
    });
  }

  await models.Trip.create({
    route: world.routeId,
    bus: new mongoose.Types.ObjectId(),
    conductor: new mongoose.Types.ObjectId(),
    plan: world.cps.map((cp, i) => ({
      checkpoint: cp._id,
      name: cp.name,
      type: 'station',
      baselineMinutesFromPrevious: [0, 40, 60][i],
    })),
    scheduledDeparture: start,
    actualDeparture: start,
    actualArrival: at(elapsed),
    status: 'arrived',
    computedETAs: stops,
  });
}

test('an operator can see what their own trips say about a route', async () => {
  // Six trips: the first leg runs 6 minutes over its baseline every time, the
  // second within a minute of it.
  for (let i = 1; i <= 6; i += 1) await ranTrip(i, [46, 59]);

  const res = await world
    .as(request(app).get(`/api/admin/routes/${world.routeId}/calibration`))
    .expect(200);

  assert.equal(res.body.tripsConsidered, 6);
  assert.equal(res.body.suggestions, 1, 'only the leg that is actually off');

  const leg = res.body.legs[0];
  assert.equal(leg.fromName, 'PITX');
  assert.equal(leg.toName, 'Alabang');
  assert.equal(leg.bands[0].measuredMinutes, 46);
  assert.equal(leg.bands[0].currentMinutes, 40);
});

test('trips outside the window, and trips still running, say nothing', async () => {
  for (let i = 1; i <= 6; i += 1) await ranTrip(i, [46, 59]);
  for (let i = 40; i <= 45; i += 1) await ranTrip(i, [90, 59]);

  const res = await world
    .as(request(app).get(`/api/admin/routes/${world.routeId}/calibration?days=30`))
    .expect(200);
  assert.equal(res.body.tripsConsidered, 6);
  assert.equal(res.body.legs[0].bands[0].measuredMinutes, 46);

  // A trip that is still on the road has legs it has not driven yet.
  await models.Trip.updateOne({}, { status: 'in_transit' });
  const fewer = await world
    .as(request(app).get(`/api/admin/routes/${world.routeId}/calibration`))
    .expect(200);
  assert.equal(fewer.body.tripsConsidered, 5);
});

test('a route nobody has run yet suggests nothing, and says so plainly', async () => {
  const res = await world
    .as(request(app).get(`/api/admin/routes/${world.routeId}/calibration`))
    .expect(200);
  assert.equal(res.body.tripsConsidered, 0);
  assert.deepEqual(res.body.legs, []);
  assert.equal(res.body.suggestions, 0);
});

test('only an admin can ask', async () => {
  await request(app).get(`/api/admin/routes/${world.routeId}/calibration`).expect(401);
});
