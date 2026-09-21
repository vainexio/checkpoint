import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';

import {
  addDays,
  departureOn,
  generateScheduledTrips,
  manilaDate,
  plannedDepartures,
  weekdayOf,
} from '../services/scheduleService.js';
import { liveWindow } from '../services/tripWindow.js';

process.env.JWT_SECRET = 'test-secret-not-used-anywhere-real';

const HOUR = 60 * 60 * 1000;
const DAILY = [0, 1, 2, 3, 4, 5, 6];

/* ------------------------------------------------------ the calendar, pure -- */

test('a Manila wall-clock time becomes the right instant', () => {
  // 06:00 in Manila is 22:00 UTC the evening before.
  assert.equal(departureOn('2026-09-21', '06:00').toISOString(), '2026-09-20T22:00:00.000Z');
  assert.equal(departureOn('2026-09-21', '23:30').toISOString(), '2026-09-21T15:30:00.000Z');
});

test('the service day is the Manila day, whatever the server clock says', () => {
  // 01:00 on the 21st in Manila is still the 20th in UTC.
  assert.equal(manilaDate(new Date('2026-09-20T17:00:00Z')), '2026-09-21');
  assert.equal(manilaDate(new Date('2026-09-20T15:59:00Z')), '2026-09-20');
  assert.equal(weekdayOf('2026-09-21'), 1); // a Monday
  assert.equal(addDays('2026-09-30', 1), '2026-10-01');
});

// Monday 21 September 2026, 10:00 in Manila.
const MONDAY_10AM = new Date('2026-09-21T02:00:00Z');
const pattern = (over = {}) => ({
  departureTime: '06:00',
  daysOfWeek: DAILY,
  startDate: '2026-09-01',
  endDate: null,
  skipDates: [],
  ...over,
});

test('a daily schedule fills the week ahead, but not a departure already gone', () => {
  const days = plannedDepartures(pattern(), { now: MONDAY_10AM }).map((d) => d.serviceDate);
  // Today's 06:00 left four hours ago, so the week starts tomorrow.
  assert.deepEqual(days, [
    '2026-09-22',
    '2026-09-23',
    '2026-09-24',
    '2026-09-25',
    '2026-09-26',
    '2026-09-27',
  ]);
});

test('a later departure today is still generated', () => {
  const days = plannedDepartures(pattern({ departureTime: '18:00' }), { now: MONDAY_10AM });
  assert.equal(days[0].serviceDate, '2026-09-21');
  assert.equal(days.length, 7);
});

test('only the chosen weekdays run', () => {
  const days = plannedDepartures(pattern({ departureTime: '18:00', daysOfWeek: [1, 3, 5] }), {
    now: MONDAY_10AM,
  }).map((d) => d.serviceDate);
  assert.deepEqual(days, ['2026-09-21', '2026-09-23', '2026-09-25']);
});

test('start, end and skipped days are all respected', () => {
  const days = plannedDepartures(
    pattern({
      departureTime: '18:00',
      startDate: '2026-09-22',
      endDate: '2026-09-25',
      skipDates: ['2026-09-24'],
    }),
    { now: MONDAY_10AM }
  ).map((d) => d.serviceDate);
  assert.deepEqual(days, ['2026-09-22', '2026-09-23', '2026-09-25']);
});

test('the live window hides trips too far ahead, never run, or abandoned', () => {
  const now = new Date('2026-09-21T02:00:00Z');
  const w = liveWindow(now);
  assert.equal(w.scheduledDeparture.$lte.getTime(), now.getTime() + 12 * HOUR);
  assert.equal(w.scheduledDeparture.$gte.getTime(), now.getTime() - 24 * HOUR);
  // A roster view keeps everything ahead.
  assert.equal(liveWindow(now, { upcomingHours: null }).scheduledDeparture.$lte, undefined);
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
  // The unique (schedule, serviceDate) index is the duplicate guarantee, so it
  // has to exist before anything races against it.
  await models.Trip.init();
  app = createApp();
});

after(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

let world;

beforeEach(async () => {
  const { Bus, Checkpoint, CheckpointLog, Route, Schedule, Trip, User } = models;
  await Promise.all([
    Trip.deleteMany({}),
    Schedule.deleteMany({}),
    Route.deleteMany({}),
    Checkpoint.deleteMany({}),
    Bus.deleteMany({}),
    User.deleteMany({}),
    CheckpointLog.deleteMany({}),
  ]);

  await User.create({
    name: 'Ops Admin',
    username: 'admin',
    role: 'admin',
    passwordHash: await User.hashPassword('checkpoint123'),
  });
  const login = await request(app)
    .post('/api/auth/login')
    .send({ username: 'admin', password: 'checkpoint123' })
    .expect(200);
  const token = login.body.token;
  const as = (req) => req.set('Authorization', `Bearer ${token}`);

  const a = await as(request(app).post('/api/admin/checkpoints'))
    .send({ name: 'PITX', type: 'station', isTerminal: true, location: { lat: 14.51, lng: 120.99 } })
    .expect(201);
  const b = await as(request(app).post('/api/admin/checkpoints'))
    .send({ name: 'Lipa', type: 'station', isTerminal: true, location: { lat: 13.95, lng: 121.16 } })
    .expect(201);
  const route = await as(request(app).post('/api/admin/routes'))
    .send({
      name: 'PITX – Lipa',
      checkpoints: [
        { checkpoint: a.body._id, baselineMinutesFromPrevious: 0 },
        { checkpoint: b.body._id, baselineMinutesFromPrevious: 150 },
      ],
    })
    .expect(201);
  const bus = await as(request(app).post('/api/admin/buses'))
    .send({ plateNumber: 'SBL 3561', operatorName: 'Southbound Lines' })
    .expect(201);
  const spare = await as(request(app).post('/api/admin/buses'))
    .send({ plateNumber: 'SBL 6189', operatorName: 'Southbound Lines' })
    .expect(201);
  const conductor = await as(request(app).post('/api/admin/conductors'))
    .send({ name: 'Dennis Aguilar', username: 'dennis', password: 'checkpoint123' })
    .expect(201);

  world = {
    as,
    stationId: a.body._id,
    routeId: route.body._id,
    busId: bus.body._id,
    spareBusId: spare.body._id,
    conductorId: conductor.body._id,
  };
});

/** A Manila HH:MM a few hours from now, so the first departure is always ahead. */
const manilaClockIn = (hours) => {
  const t = new Date(Date.now() + hours * HOUR + 8 * HOUR);
  return `${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')}`;
};

async function createDaily(time = manilaClockIn(3)) {
  const res = await world
    .as(request(app).post('/api/admin/schedules'))
    .send({
      routeId: world.routeId,
      busId: world.busId,
      conductorId: world.conductorId,
      departureTime: time,
      daysOfWeek: DAILY,
    })
    .expect(201);
  return res.body;
}

const scheduledTrips = (scheduleId) =>
  models.Trip.find({ schedule: scheduleId }).sort({ scheduledDeparture: 1 }).lean();

test('creating a schedule generates its week straight away', async () => {
  const time = manilaClockIn(3);
  const expected = plannedDepartures({ ...pattern({ departureTime: time }), startDate: manilaDate() })
    .length;
  const { schedule, created } = await createDaily(time);

  // Seven, unless three hours from now is already past midnight in Manila, in
  // which case today's run has gone and the window holds six.
  assert.ok(expected === 7 || expected === 6);
  assert.equal(created, expected);
  assert.equal(schedule.upcomingTrips, expected);
  assert.ok(schedule.nextDeparture);

  const trips = await scheduledTrips(schedule.id);
  assert.equal(new Set(trips.map((t) => t.serviceDate)).size, expected, 'one trip per day');
  assert.ok(trips.every((t) => t.plan.length === 2), 'each trip has its own frozen plan');
});

test('generation run again, or twice at once, never duplicates a day', async () => {
  const { schedule, created } = await createDaily();

  const again = await generateScheduledTrips();
  assert.equal(again.created, 0);

  // Two generators racing, as two servers on one database would.
  await models.Trip.deleteMany({});
  await Promise.all([generateScheduledTrips(), generateScheduledTrips()]);
  assert.equal((await scheduledTrips(schedule.id)).length, created);
});

test('the trip list says which trips came from a schedule', async () => {
  const { schedule, created } = await createDaily();
  await world
    .as(request(app).post('/api/admin/trips'))
    .send({
      routeId: world.routeId,
      busId: world.spareBusId,
      conductorId: world.conductorId,
      scheduledDeparture: new Date(Date.now() + HOUR).toISOString(),
    })
    .expect(201);

  const res = await world.as(request(app).get('/api/admin/trips')).expect(200);
  const kinds = res.body.trips.map((t) => t.source.kind);
  assert.equal(kinds.filter((k) => k === 'manual').length, 1);
  assert.equal(kinds.filter((k) => k === 'schedule').length, created);
  assert.ok(
    res.body.trips
      .filter((t) => t.source.kind === 'schedule')
      .every((t) => t.source.scheduleId === schedule.id && t.source.serviceDate)
  );
});

test('a cancelled day stays cancelled when the schedule regenerates', async () => {
  const { schedule } = await createDaily();
  const [first] = await scheduledTrips(schedule.id);

  await world
    .as(request(app).put(`/api/admin/trips/${first._id}`))
    .send({ status: 'cancelled' })
    .expect(200);
  await generateScheduledTrips();

  const trips = await scheduledTrips(schedule.id);
  const sameDay = trips.filter((t) => t.serviceDate === first.serviceDate);
  assert.equal(sameDay.length, 1);
  assert.equal(sameDay[0].status, 'cancelled');
});

test('a deleted day is remembered, so it is not put back', async () => {
  const { schedule, created } = await createDaily();
  const [first] = await scheduledTrips(schedule.id);

  await world.as(request(app).delete(`/api/admin/trips/${first._id}`)).expect(204);
  const stored = await models.Schedule.findById(schedule.id).lean();
  assert.deepEqual(stored.skipDates, [first.serviceDate]);

  await generateScheduledTrips();
  const trips = await scheduledTrips(schedule.id);
  assert.equal(trips.length, created - 1);
  assert.ok(!trips.some((t) => t.serviceDate === first.serviceDate));
});

test('one day can be changed by hand without breaking the pattern', async () => {
  const { schedule } = await createDaily(manilaClockIn(3));
  const [first, second] = await scheduledTrips(schedule.id);

  // A different bus on one day only.
  const edited = await world
    .as(request(app).put(`/api/admin/trips/${second._id}`))
    .send({ busId: world.spareBusId })
    .expect(200);
  assert.equal(edited.body.trip.source.overridden, true);

  // Then the whole pattern moves an hour later.
  const moved = manilaClockIn(4);
  await world
    .as(request(app).put(`/api/admin/schedules/${schedule.id}`))
    .send({ departureTime: moved })
    .expect(200);

  const trips = await scheduledTrips(schedule.id);
  assert.equal(new Set(trips.map((t) => t.serviceDate)).size, trips.length, 'still one per day');

  const kept = trips.find((t) => String(t._id) === String(second._id));
  assert.ok(kept, 'the edited day survives');
  assert.equal(String(kept.bus), world.spareBusId);
  assert.equal(kept.scheduledDeparture.getTime(), second.scheduledDeparture.getTime());

  const regenerated = trips.find((t) => t.serviceDate === first.serviceDate);
  assert.notEqual(String(regenerated._id), String(first._id), 'untouched days are regenerated');
  assert.equal(
    regenerated.scheduledDeparture.getTime(),
    departureOn(first.serviceDate, moved).getTime()
  );
});

test('pausing clears the untouched trips ahead, and resuming brings them back', async () => {
  const { schedule, created } = await createDaily();

  const paused = await world
    .as(request(app).put(`/api/admin/schedules/${schedule.id}`))
    .send({ isActive: false })
    .expect(200);
  assert.equal(paused.body.removed, created);
  assert.equal((await scheduledTrips(schedule.id)).length, 0);

  // A paused schedule is left alone by the background run.
  await generateScheduledTrips();
  assert.equal((await scheduledTrips(schedule.id)).length, 0);

  const resumed = await world
    .as(request(app).put(`/api/admin/schedules/${schedule.id}`))
    .send({ isActive: true })
    .expect(200);
  assert.equal(resumed.body.created, created);
});

test('a trip with anything logged against it is never regenerated away', async () => {
  const { schedule } = await createDaily();
  const [first] = await scheduledTrips(schedule.id);
  await models.CheckpointLog.create({
    trip: first._id,
    type: 'load_report',
    load: 'seats',
    reportedAt: new Date(),
    clientLogId: 'pre-departure-seat-report',
  });

  await world
    .as(request(app).put(`/api/admin/schedules/${schedule.id}`))
    .send({ departureTime: manilaClockIn(5) })
    .expect(200);

  assert.ok(await models.Trip.exists({ _id: first._id }));
});

test('deleting a schedule removes only its untouched future trips', async () => {
  const { schedule, created } = await createDaily();
  const [first] = await scheduledTrips(schedule.id);
  await world
    .as(request(app).put(`/api/admin/trips/${first._id}`))
    .send({ conductorId: world.conductorId })
    .expect(200);

  const res = await world.as(request(app).delete(`/api/admin/schedules/${schedule.id}`)).expect(200);
  assert.equal(res.body.removed, created - 1);
  assert.ok(await models.Trip.exists({ _id: first._id }), 'the hand-edited trip stays');
});

test('bad schedules are refused with a reason', async () => {
  const base = { routeId: world.routeId, busId: world.busId, conductorId: world.conductorId };

  const noDays = await world
    .as(request(app).post('/api/admin/schedules'))
    .send({ ...base, departureTime: '06:00', daysOfWeek: [] })
    .expect(400);
  assert.ok(noDays.body.details.includes('daysOfWeek'));

  await world
    .as(request(app).post('/api/admin/schedules'))
    .send({ ...base, departureTime: '6am', daysOfWeek: DAILY })
    .expect(400);

  await world
    .as(request(app).post('/api/admin/schedules'))
    .send({ ...base, busId: new mongoose.Types.ObjectId().toString(), departureTime: '06:00', daysOfWeek: DAILY })
    .expect(400);
});

test('what a schedule uses cannot be deleted from under it', async () => {
  await createDaily();
  // Its generated trips would block these anyway; clear them to test the
  // schedule check on its own.
  await models.Trip.deleteMany({});

  await world.as(request(app).delete(`/api/admin/buses/${world.busId}`)).expect(409);
  await world.as(request(app).delete(`/api/admin/conductors/${world.conductorId}`)).expect(409);
  await world.as(request(app).delete(`/api/admin/routes/${world.routeId}`)).expect(409);
});

test('the board shows the next departures, not the whole week', async () => {
  await createDaily(manilaClockIn(3));

  const board = await request(app).get(`/api/public/stations/${world.stationId}/board`).expect(200);
  // A week of generated trips, one inside the next twelve hours.
  assert.equal(board.body.arrivals.length, 1);

  const row = board.body.arrivals[0];
  assert.equal(row.boardKind, 'departure');
  // Three hours out: on the timetable, not yet standing in the bay.
  assert.equal(row.departsLater, true);
});

test('a departure inside the hour is boarding, and leads the board', async () => {
  await world
    .as(request(app).post('/api/admin/trips'))
    .send({
      routeId: world.routeId,
      busId: world.busId,
      conductorId: world.conductorId,
      scheduledDeparture: new Date(Date.now() + 20 * 60000).toISOString(),
    })
    .expect(201);

  const board = await request(app).get(`/api/public/stations/${world.stationId}/board`).expect(200);
  assert.equal(board.body.arrivals[0].departsLater, false);
});

test('a trip that never left drops off the board, but stays in the operator list', async () => {
  const trip = await world
    .as(request(app).post('/api/admin/trips'))
    .send({
      routeId: world.routeId,
      busId: world.busId,
      conductorId: world.conductorId,
      scheduledDeparture: new Date(Date.now() - 5 * HOUR).toISOString(),
    })
    .expect(201);

  const board = await request(app).get(`/api/public/stations/${world.stationId}/board`).expect(200);
  assert.equal(board.body.arrivals.length, 0);

  const list = await world.as(request(app).get('/api/admin/trips')).expect(200);
  const listed = list.body.trips.find((t) => t.id === trip.body.trip.id);
  assert.equal(listed.didNotRun, true);
});

test('a trip moved into rush hour takes the rush-hour baseline its route gave it', async () => {
  const lipa = await models.Checkpoint.findOne({ name: 'Lipa' }).lean();
  const pitx = await models.Checkpoint.findOne({ name: 'PITX' }).lean();
  const banded = await world
    .as(request(app).post('/api/admin/routes'))
    .send({
      name: 'PITX – Lipa (banded)',
      checkpoints: [
        { checkpoint: pitx._id, baselineMinutesFromPrevious: 0 },
        { checkpoint: lipa._id, baselineMinutesFromPrevious: 150, pmPeakMinutes: 190 },
      ],
    })
    .expect(201);
  assert.equal(banded.body.checkpoints[1].pmPeakMinutes, 190);

  const tomorrow = addDays(manilaDate(), 1);
  const created = await world
    .as(request(app).post('/api/admin/trips'))
    .send({
      routeId: banded.body._id,
      busId: world.busId,
      conductorId: world.conductorId,
      scheduledDeparture: departureOn(tomorrow, '11:00').toISOString(),
    })
    .expect(201);
  assert.equal(created.body.trip.stops[1].baselineMinutesFromPrevious, 150);

  const moved = await world
    .as(request(app).put(`/api/admin/trips/${created.body.trip.id}`))
    .send({ scheduledDeparture: departureOn(tomorrow, '17:30').toISOString() })
    .expect(200);
  assert.equal(moved.body.trip.stops[1].baselineMinutesFromPrevious, 190);
});
