/**
 * Seed the demo dataset: the Cubao – Baguio route from §7, buses, accounts, and
 * three trips staged so every state on the public board is visible immediately —
 * one running roughly on time, one gone quiet long enough to be flagged stale,
 * and one still waiting to depart.
 *
 * Run with:  npm run seed        (add --fresh to wipe first)
 */
import 'dotenv/config';
import mongoose from 'mongoose';

import { Bus, Checkpoint, CheckpointLog, Route, Trip, User } from './models/index.js';
import { buildPlan } from './services/etaEngine.js';
import { recomputeTrip } from './services/tripService.js';

const FRESH = process.argv.includes('--fresh');

// Demo credentials. Fine for a local database; change them before this touches
// anything real.
const ADMIN = { name: 'Ops Admin', username: 'admin', password: 'checkpoint123' };
const CONDUCTORS = [
  { name: 'Rey Santiago', username: 'rey', password: 'checkpoint123' },
  { name: 'Marlon Cruz', username: 'marlon', password: 'checkpoint123' },
];

// Approximate real-world coordinates, good enough to place a pin and to give
// the traffic provider genuine segment endpoints along NLEX/TPLEX and Kennon.
const CHECKPOINTS = [
  {
    name: 'Cubao Terminal',
    type: 'station',
    isTerminal: true,
    area: 'Quezon City, Metro Manila',
    location: { lat: 14.6217, lng: 121.053 },
  },
  {
    name: 'Balintawak',
    type: 'station',
    isTerminal: false,
    area: 'Quezon City, Metro Manila',
    location: { lat: 14.657, lng: 121.003 },
  },
  {
    name: 'Tarlac stop',
    type: 'station',
    isTerminal: false,
    area: 'Tarlac City, Tarlac',
    location: { lat: 15.4802, lng: 120.5979 },
  },
  {
    name: 'TPLEX – Rosario Exit',
    type: 'landmark',
    isTerminal: false,
    area: 'Rosario, La Union',
    location: { lat: 16.229, lng: 120.49 },
  },
  {
    name: 'Baguio Terminal',
    type: 'station',
    isTerminal: true,
    area: 'Governor Pack Road, Baguio City',
    location: { lat: 16.4103, lng: 120.596 },
  },
];

// Baseline minutes from the previous checkpoint. 185 minutes end to end.
const BASELINES = [0, 20, 80, 40, 45];

const BUSES = [
  { plateNumber: 'NRT 8821', operatorName: 'Northline Express' },
  { plateNumber: 'NRT 4416', operatorName: 'Northline Express' },
  { plateNumber: 'NRT 2093', operatorName: 'Northline Express' },
];

const minutesAgo = (m) => new Date(Date.now() - m * 60_000);
const minutesFromNow = (m) => new Date(Date.now() + m * 60_000);

async function seed() {
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI is not set. Copy server/.env.example to server/.env first.');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB.');

  if (FRESH) {
    await Promise.all([
      CheckpointLog.deleteMany({}),
      Trip.deleteMany({}),
      Route.deleteMany({}),
      Checkpoint.deleteMany({}),
      Bus.deleteMany({}),
      User.deleteMany({}),
    ]);
    console.log('Cleared existing data (--fresh).');
  }

  /* ------------------------------------------------------------ checkpoints */
  const checkpoints = [];
  for (const spec of CHECKPOINTS) {
    const cp = await Checkpoint.findOneAndUpdate({ name: spec.name }, spec, {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    });
    checkpoints.push(cp);
  }
  console.log(`Checkpoints ready: ${checkpoints.map((c) => c.name).join(' → ')}`);

  /* ----------------------------------------------------------------- route */
  const routeCheckpoints = checkpoints.map((cp, i) => ({
    checkpoint: cp._id,
    baselineMinutesFromPrevious: BASELINES[i],
  }));

  let route = await Route.findOne({ name: 'Cubao – Baguio' });
  if (!route) route = new Route({ name: 'Cubao – Baguio' });
  route.checkpoints = routeCheckpoints;
  route.isActive = true;
  await route.save();
  console.log(`Route ready: ${route.name} (${BASELINES.reduce((a, b) => a + b, 0)} min baseline)`);

  /* ------------------------------------------------------------------ buses */
  const buses = [];
  for (const spec of BUSES) {
    buses.push(
      await Bus.findOneAndUpdate({ plateNumber: spec.plateNumber }, spec, {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      })
    );
  }
  console.log(`Buses ready: ${buses.map((b) => b.plateNumber).join(', ')}`);

  /* --------------------------------------------------------------- accounts */
  const upsertUser = async ({ name, username, password }, role) => {
    let user = await User.findOne({ username });
    if (!user) user = new User({ username, role });
    user.name = name;
    user.role = role;
    user.isActive = true;
    user.passwordHash = await User.hashPassword(password);
    await user.save();
    return user;
  };

  const admin = await upsertUser(ADMIN, 'admin');
  const conductors = [];
  for (const c of CONDUCTORS) conductors.push(await upsertUser(c, 'conductor'));
  console.log(`Accounts ready: ${admin.username} (admin), ${conductors.map((c) => c.username).join(', ')} (conductors)`);

  /* ------------------------------------------------------------------ trips */
  // Rebuild demo trips every run so their timings stay relative to "now".
  const existing = await Trip.find({ route: route._id }).select('_id').lean();
  if (existing.length) {
    await CheckpointLog.deleteMany({ trip: { $in: existing.map((t) => t._id) } });
    await Trip.deleteMany({ _id: { $in: existing.map((t) => t._id) } });
  }

  const populatedRoute = await Route.findById(route._id).populate(
    'checkpoints.checkpoint',
    'name type'
  );
  const plan = buildPlan(populatedRoute);
  const idFor = (name) => plan.find((p) => p.name === name).checkpoint;

  let logSeq = 0;
  const makeLog = (trip, type, reportedAt, extra = {}) => {
    logSeq += 1;
    return {
      trip: trip._id,
      type,
      reportedAt,
      syncedAt: reportedAt,
      clientLogId: `seed-${trip._id}-${logSeq}`,
      checkpoint: null,
      delayReason: null,
      ...extra,
    };
  };

  const createTrip = async ({ bus, conductor, scheduledDeparture }) =>
    Trip.create({
      route: route._id,
      bus: bus._id,
      conductor: conductor._id,
      plan,
      scheduledDeparture,
      status: 'scheduled',
    });

  // Trip 1 — left 95 minutes ago, confirmed Balintawak 8 minutes behind
  // baseline. Reporting normally; the board should show a live ETA.
  const trip1 = await createTrip({
    bus: buses[0],
    conductor: conductors[0],
    scheduledDeparture: minutesAgo(95),
  });
  await CheckpointLog.insertMany([
    makeLog(trip1, 'departed', minutesAgo(95)),
    makeLog(trip1, 'passed_checkpoint', minutesAgo(67), { checkpoint: idFor('Balintawak') }),
    makeLog(trip1, 'delayed', minutesAgo(40), { delayReason: 'traffic' }),
  ]);

  // Trip 2 — confirmed Tarlac 95 minutes ago and nothing since. The next
  // segment is only 40 minutes, so this trip is well past its grace window and
  // the board must say so rather than keep showing a confident number.
  const trip2 = await createTrip({
    bus: buses[1],
    conductor: conductors[1],
    scheduledDeparture: minutesAgo(200),
  });
  await CheckpointLog.insertMany([
    makeLog(trip2, 'departed', minutesAgo(200)),
    makeLog(trip2, 'passed_checkpoint', minutesAgo(180), { checkpoint: idFor('Balintawak') }),
    makeLog(trip2, 'passed_checkpoint', minutesAgo(95), { checkpoint: idFor('Tarlac stop') }),
  ]);

  // Trip 3 — still at the terminal, leaving in 45 minutes.
  const trip3 = await createTrip({
    bus: buses[2],
    conductor: conductors[0],
    scheduledDeparture: minutesFromNow(45),
  });

  for (const t of [trip1, trip2, trip3]) await recomputeTrip(t._id);

  const summary = await Trip.find({ route: route._id })
    .populate('bus', 'plateNumber')
    .select('status cumulativeVarianceMinutes bus')
    .lean();

  console.log('\nDemo trips:');
  for (const t of summary) {
    const variance = t.cumulativeVarianceMinutes;
    const label = variance === 0 ? 'on baseline' : `${variance > 0 ? '+' : ''}${variance} min`;
    console.log(`  ${t.bus.plateNumber}  ${t.status.padEnd(11)} ${label}`);
  }

  console.log('\nSign in with:');
  console.log(`  Admin      ${ADMIN.username} / ${ADMIN.password}`);
  for (const c of CONDUCTORS) console.log(`  Conductor  ${c.username} / ${c.password}`);
  console.log('\nGuests need no account at all.');

  await mongoose.disconnect();
}

seed().catch(async (err) => {
  console.error('Seed failed:', err);
  await mongoose.disconnect();
  process.exit(1);
});
