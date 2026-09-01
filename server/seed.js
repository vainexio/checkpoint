/**
 * Seed a demonstrable dataset: two real Philippine corridors, and trips staged
 * so every state the board can show is visible the moment you open it — on
 * time, running late, running early, gone quiet, not yet departed, and finished.
 *
 * The coordinates and baselines here are measured, not invented. Places come
 * from OpenStreetMap and each leg's baseline is TomTom's free-flow driving time
 * for a bus, plus a few minutes of dwell where passengers board. Free-flow is
 * the right basis for a baseline: a baseline is what a leg normally costs, and
 * the live traffic layer exists precisely to say how today differs from that.
 * See scripts/measureRoute.js, which produced these numbers.
 *
 * Run with:  npm run seed        (add --fresh to wipe first)
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

// Load server/.env by its own path, not the working directory's.
dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '.env') });

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
  { name: 'Dennis Aguilar', username: 'dennis', password: 'checkpoint123' },
  { name: 'Joel Ramirez', username: 'joel', password: 'checkpoint123' },
];

/** `baseline` is minutes from the previous checkpoint on this route. */
const ROUTES = [
  {
    name: 'Cubao – Baguio',
    checkpoints: [
      {
        name: 'Cubao Terminal',
        type: 'station',
        isTerminal: true,
        area: 'Quezon City, Metro Manila',
        location: { lat: 14.6217, lng: 121.053 },
        baseline: 0,
      },
      {
        name: 'Balintawak',
        type: 'station',
        area: 'Quezon City, Metro Manila',
        location: { lat: 14.6574221, lng: 121.0038959 },
        baseline: 20,
      },
      {
        name: 'Tarlac stop',
        type: 'station',
        area: 'Tarlac City, Tarlac',
        location: { lat: 15.486869, lng: 120.5898647 },
        baseline: 157,
      },
      {
        name: 'TPLEX – Rosario Exit',
        type: 'landmark',
        area: 'Rosario, La Union',
        location: { lat: 16.2299397, lng: 120.487704 },
        baseline: 90,
      },
      {
        name: 'Baguio Terminal',
        type: 'station',
        isTerminal: true,
        area: 'Baguio, Benguet',
        location: { lat: 16.4138341, lng: 120.5914077 },
        baseline: 84,
      },
    ],
  },
  {
    name: 'PITX – Lipa',
    checkpoints: [
      {
        name: 'PITX',
        type: 'station',
        isTerminal: true,
        area: 'Parañaque, Metro Manila',
        location: { lat: 14.5099649, lng: 120.9913732 },
        baseline: 0,
      },
      {
        name: 'Alabang',
        type: 'station',
        area: 'Muntinlupa, Metro Manila',
        location: { lat: 14.4190326, lng: 121.044338 },
        baseline: 40,
      },
      {
        name: 'Calamba Crossing',
        type: 'station',
        area: 'Calamba, Laguna',
        location: { lat: 14.1940522, lng: 121.1596881 },
        baseline: 47,
      },
      {
        name: 'Santo Tomas',
        type: 'station',
        area: 'Santo Tomas, Batangas',
        location: { lat: 14.110721, lng: 121.1423512 },
        baseline: 40,
      },
      {
        name: 'Tanauan',
        type: 'station',
        area: 'Tanauan, Batangas',
        location: { lat: 14.0865988, lng: 121.1258532 },
        baseline: 23,
      },
      {
        name: 'Lipa City',
        type: 'station',
        isTerminal: true,
        area: 'Lipa, Batangas',
        location: { lat: 13.9572279, lng: 121.1646223 },
        baseline: 34,
      },
    ],
  },
];

const BUSES = [
  { plateNumber: 'NRT 8821', operatorName: 'Northline Express' },
  { plateNumber: 'NRT 4416', operatorName: 'Northline Express' },
  { plateNumber: 'NRT 2093', operatorName: 'Northline Express' },
  { plateNumber: 'SBL 1174', operatorName: 'Southbound Lines' },
  { plateNumber: 'SBL 3308', operatorName: 'Southbound Lines' },
  { plateNumber: 'SBL 5629', operatorName: 'Southbound Lines' },
  { plateNumber: 'SBL 7742', operatorName: 'Southbound Lines' },
  { plateNumber: 'SBL 9015', operatorName: 'Southbound Lines' },
];

/**
 * Trips described by what the board should show, not by raw timestamps. Each
 * confirm is [checkpoint, minutes ago]; the engine works out whether that adds
 * up to early, late or quiet.
 */
const TRIPS = [
  // ---------------------------------------------------------- Cubao – Baguio
  {
    route: 'Cubao – Baguio',
    bus: 'NRT 8821',
    conductor: 'rey',
    departedAgo: 60,
    confirms: [['Balintawak', 38]], // 22 min in, against a 20 min baseline
    note: 'past Balintawak, near enough on time',
  },
  {
    route: 'Cubao – Baguio',
    bus: 'NRT 4416',
    conductor: 'marlon',
    departedAgo: 205,
    confirms: [
      ['Balintawak', 183],
      ['Tarlac stop', 15],
    ],
    left: ['Tarlac stop', 6],
    delay: ['traffic', 40],
    note: 'left Tarlac, on the road, running late',
  },
  {
    route: 'Cubao – Baguio',
    bus: 'NRT 2093',
    conductor: 'rey',
    scheduledInMinutes: 45,
    note: 'still at Cubao',
  },

  // ------------------------------------------------------------- PITX – Lipa
  {
    route: 'PITX – Lipa',
    bus: 'SBL 1174',
    conductor: 'dennis',
    departedAgo: 55,
    confirms: [['Alabang', 13]], // 42 min in, against a 40 min baseline
    // No pull-out reported yet: this bus is standing at Alabang boarding, and
    // the board should tell anyone waiting there to hurry.
    note: 'AT Alabang, boarding right now',
  },
  {
    route: 'PITX – Lipa',
    bus: 'SBL 3308',
    conductor: 'joel',
    departedAgo: 120,
    confirms: [
      ['Alabang', 75],
      ['Calamba Crossing', 25],
    ],
    left: ['Calamba Crossing', 19],
    delay: ['loading', 18],
    note: 'left Calamba, on the road, running late',
  },
  {
    route: 'PITX – Lipa',
    bus: 'SBL 5629',
    conductor: 'dennis',
    departedAgo: 160,
    confirms: [
      ['Alabang', 123],
      ['Calamba Crossing', 79],
      ['Santo Tomas', 42],
      ['Tanauan', 22],
    ],
    left: ['Tanauan', 17],
    note: 'left Tanauan, approaching Lipa, running early',
  },
  {
    route: 'PITX – Lipa',
    bus: 'SBL 7742',
    conductor: 'joel',
    // Confirmed Santo Tomas and nothing since. The next leg is 23 minutes, so
    // this is far past its grace window and must be flagged, not guessed at.
    departedAgo: 240,
    confirms: [
      ['Alabang', 197],
      ['Calamba Crossing', 148],
      ['Santo Tomas', 105],
    ],
    note: 'quiet since Santo Tomas — should read as unconfirmed',
  },
  {
    route: 'PITX – Lipa',
    bus: 'SBL 9015',
    conductor: 'marlon',
    departedAgo: 300,
    confirms: [
      ['Alabang', 258],
      ['Calamba Crossing', 212],
      ['Santo Tomas', 170],
      ['Tanauan', 148],
    ],
    arrivedAgo: 112,
    note: 'completed run',
  },
];

const minutesAgo = (m) => new Date(Date.now() - m * 60_000);
const minutesFromNow = (m) => new Date(Date.now() + m * 60_000);

async function seed() {
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI is not set. Copy server/.env.example to server/.env first.');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB.\n');

  if (FRESH) {
    await Promise.all([
      CheckpointLog.deleteMany({}),
      Trip.deleteMany({}),
      Route.deleteMany({}),
      Checkpoint.deleteMany({}),
      Bus.deleteMany({}),
      User.deleteMany({}),
    ]);
    console.log('Cleared existing data (--fresh).\n');
  }

  /* ------------------------------------------------- checkpoints and routes */
  const routeByName = new Map();

  for (const spec of ROUTES) {
    const entries = [];

    for (const cp of spec.checkpoints) {
      const doc = await Checkpoint.findOneAndUpdate(
        { name: cp.name },
        {
          name: cp.name,
          type: cp.type,
          isTerminal: !!cp.isTerminal,
          area: cp.area,
          location: cp.location,
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      entries.push({ checkpoint: doc._id, baselineMinutesFromPrevious: cp.baseline });
    }

    let route = await Route.findOne({ name: spec.name });
    if (!route) route = new Route({ name: spec.name });
    route.checkpoints = entries;
    route.isActive = true;
    await route.save();
    routeByName.set(spec.name, route);

    const total = spec.checkpoints.reduce((s, c) => s + c.baseline, 0);
    console.log(
      `Route  ${spec.name.padEnd(16)} ${spec.checkpoints.length} checkpoints · ` +
        `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, '0')}m baseline`
    );
  }

  /* ------------------------------------------------------------------ fleet */
  const busByPlate = new Map();
  for (const spec of BUSES) {
    busByPlate.set(
      spec.plateNumber,
      await Bus.findOneAndUpdate({ plateNumber: spec.plateNumber }, spec, {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      })
    );
  }
  const operators = new Set(BUSES.map((b) => b.operatorName));
  console.log(`\nBuses  ${BUSES.length} across ${operators.size} operators`);

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
  const conductorByUsername = new Map();
  for (const c of CONDUCTORS) {
    conductorByUsername.set(c.username, await upsertUser(c, 'conductor'));
  }
  console.log(`Users  ${admin.username} (admin) + ${CONDUCTORS.length} conductors`);

  /* ------------------------------------------------------------------ trips */
  // Rebuilt every run so their timings stay relative to "now".
  const existing = await Trip.find({}).select('_id').lean();
  if (existing.length) {
    await CheckpointLog.deleteMany({ trip: { $in: existing.map((t) => t._id) } });
    await Trip.deleteMany({});
  }

  const plans = new Map();
  for (const [name, route] of routeByName) {
    const populated = await Route.findById(route._id).populate(
      'checkpoints.checkpoint',
      'name type'
    );
    plans.set(name, buildPlan(populated));
  }

  let logSeq = 0;

  for (const spec of TRIPS) {
    const plan = plans.get(spec.route);
    const idFor = (name) => plan.find((p) => p.name === name).checkpoint;

    const trip = await Trip.create({
      route: routeByName.get(spec.route)._id,
      bus: busByPlate.get(spec.bus)._id,
      conductor: conductorByUsername.get(spec.conductor)._id,
      plan,
      scheduledDeparture: spec.scheduledInMinutes
        ? minutesFromNow(spec.scheduledInMinutes)
        : minutesAgo(spec.departedAgo),
      status: 'scheduled',
    });

    const logs = [];
    const push = (type, reportedAt, extra = {}) => {
      logSeq += 1;
      logs.push({
        trip: trip._id,
        type,
        reportedAt,
        syncedAt: reportedAt,
        clientLogId: `seed-${trip._id}-${logSeq}`,
        checkpoint: null,
        delayReason: null,
        ...extra,
      });
    };

    if (!spec.scheduledInMinutes) {
      push('departed', minutesAgo(spec.departedAgo));
      for (const [name, ago] of spec.confirms ?? []) {
        push('passed_checkpoint', minutesAgo(ago), { checkpoint: idFor(name) });
      }
      if (spec.left) {
        push('left_checkpoint', minutesAgo(spec.left[1]), { checkpoint: idFor(spec.left[0]) });
      }
      if (spec.delay) push('delayed', minutesAgo(spec.delay[1]), { delayReason: spec.delay[0] });
      if (spec.arrivedAgo) push('arrived', minutesAgo(spec.arrivedAgo));
    }

    if (logs.length) await CheckpointLog.insertMany(logs);
    await recomputeTrip(trip._id);
  }

  /* ---------------------------------------------------------------- summary */
  const summary = await Trip.find({})
    .populate('bus', 'plateNumber')
    .populate('route', 'name')
    .lean();

  console.log(`\nTrips  ${summary.length}`);
  for (const spec of TRIPS) {
    const t = summary.find((s) => s.bus.plateNumber === spec.bus);
    const v = t.cumulativeVarianceMinutes;
    const variance = t.actualDeparture ? (v === 0 ? 'on baseline' : `${v > 0 ? '+' : ''}${v} min`) : '—';
    console.log(
      `  ${spec.bus.padEnd(9)} ${t.route.name.padEnd(15)} ${t.status.padEnd(11)} ` +
        `${variance.padEnd(12)} ${spec.note}`
    );
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
