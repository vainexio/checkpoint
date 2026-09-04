/**
 * Seed a demonstrable dataset: two real Philippine corridors, and trips staged
 * so every state the board can show is visible the moment you open it — on
 * time, running late, running early, gone quiet, not yet departed, and finished.
 *
 * The coordinates and baselines here are measured, not invented. Places come
 * from OpenStreetMap, and each leg's baseline is TomTom's *historic* driving
 * time for a bus — what the leg typically takes — plus a few minutes of dwell
 * where passengers board.
 *
 * Typical, not free-flow: free-flow is what an empty road costs, which a bus in
 * Metro Manila never achieves, so using it would leave every trip permanently
 * "late" and make the delayed status meaningless. Against a typical baseline,
 * variance reads as "worse than usual", which is the thing worth knowing.
 *
 * Caveat: one static number cannot represent both 9pm and the 6pm crawl. These
 * were measured off-peak, so peak departures will read late until baselines
 * become time-of-day aware. See scripts/measureRoute.js.
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

/**
 * Every stop is a real place a bus actually pulls into.
 *
 * This matters more than it sounds. Geocoding a town name returns its municipal
 * hall — and no bus on the Maharlika Highway goes to Santo Tomas City Hall. A
 * checkpoint sited there puts the pin where nobody can wait, sends walking
 * directions to a town hall, and makes the measured leg include a detour off
 * the highway that the bus never drives, so the baseline is wrong too.
 *
 * Each of these was verified against OpenStreetMap's `amenity=bus_station`
 * tag rather than a name search (see scripts/findTerminals.js). Calamba is the
 * clearest example: its real stop is Turbina, on the highway, about 3 km from
 * the city hall a name search returns.
 */
const STOPS = {
  araneta: {
    name: 'Araneta City Bus Station',
    type: 'station',
    isTerminal: true,
    area: 'Cubao, Quezon City',
    location: { lat: 14.621413, lng: 121.055331 },
  },
  balintawak: {
    name: 'Balintawak Interchange',
    type: 'station',
    // A roadside pick-up on EDSA before NLEX rather than a terminal building.
    // OSM has no bus_station here, but buses stop and board — which is the
    // test that matters.
    area: 'EDSA Cloverleaf, Quezon City',
    location: { lat: 14.6574221, lng: 121.0038959 },
  },
  tarlac: {
    name: 'Victory Liner Tarlac Terminal',
    type: 'station',
    area: 'Tarlac City, Tarlac',
    location: { lat: 15.480646, lng: 120.594583 },
  },
  tplex: {
    name: 'TPLEX – Rosario Exit',
    // A toll exit: buses pass it at speed and nobody boards, so it is a timing
    // point and gets no arrivals board.
    type: 'landmark',
    area: 'Rosario, La Union',
    location: { lat: 16.2299397, lng: 120.487704 },
  },
  baguio: {
    name: 'Genesis Bus Terminal Baguio',
    type: 'station',
    isTerminal: true,
    area: 'Governor Pack Road, Baguio',
    location: { lat: 16.410282, lng: 120.598534 },
  },

  pitx: {
    name: 'PITX',
    type: 'station',
    isTerminal: true,
    area: 'Parañaque, Metro Manila',
    location: { lat: 14.509965, lng: 120.991373 },
  },
  alabang: {
    name: 'Alabang South Station',
    type: 'station',
    area: 'Filinvest City, Muntinlupa',
    location: { lat: 14.421736, lng: 121.043574 },
  },
  turbina: {
    name: 'Turbina Bus Terminal',
    type: 'station',
    area: 'Maharlika Highway, Calamba, Laguna',
    location: { lat: 14.186853, lng: 121.13603 },
  },
  santoTomas: {
    name: 'SM Santo Tomas Terminal',
    type: 'station',
    area: 'Maharlika Highway, Santo Tomas, Batangas',
    location: { lat: 14.105756, lng: 121.152073 },
  },
  tanauan: {
    name: 'Tanauan City Transport Terminal',
    type: 'station',
    area: 'Tanauan, Batangas',
    location: { lat: 14.082933, lng: 121.145362 },
  },
  binan: {
    name: 'JAC Liner Biñan Terminal',
    type: 'station',
    isTerminal: true,
    area: 'Sto. Domingo, Biñan, Laguna',
    location: { lat: 14.339342, lng: 121.081717 },
  },
  lucena: {
    name: 'Lucena Grand Central Terminal',
    type: 'station',
    isTerminal: true,
    area: 'Ilayang Dupay, Lucena City, Quezon',
    location: { lat: 13.958498, lng: 121.617955 },
  },
  lipa: {
    name: 'Lipa City Grand Terminal',
    type: 'station',
    isTerminal: true,
    area: 'Lipa, Batangas',
    location: { lat: 13.954528, lng: 121.161748 },
  },
};

/** Resolve a stop and attach its baseline for this particular route. */
const leg = (key, baseline) => ({ ...STOPS[key], baseline });

/**
 * Baselines are measured between these exact points, in each direction
 * separately — the road is not symmetric. Baguio → TPLEX is 71 minutes
 * descending against 81 climbing, and Tarlac → Balintawak is 133 inbound
 * against 127 outbound.
 */
const ROUTES = [
  {
    name: 'Cubao – Baguio',
    checkpoints: [
      leg('araneta', 0),
      leg('balintawak', 29),
      leg('tarlac', 127),
      leg('tplex', 84),
      leg('baguio', 81),
    ],
  },
  {
    name: 'Baguio – Cubao',
    checkpoints: [
      leg('baguio', 0),
      leg('tplex', 71),
      leg('tarlac', 89),
      leg('balintawak', 133),
      leg('araneta', 37),
    ],
  },
  {
    name: 'PITX – Lipa',
    checkpoints: [
      leg('pitx', 0),
      leg('alabang', 42),
      leg('turbina', 38),
      leg('santoTomas', 26),
      leg('tanauan', 17),
      leg('lipa', 33),
    ],
  },
  {
    /**
     * Shares PITX → Alabang → Turbina → Santo Tomas with the Lipa run, then
     * deviates east to Quezon. This is how an operator's network is really
     * shaped — a common trunk out of the city and branches at the far end —
     * and it works because checkpoints are shared records, not copies.
     */
    name: 'PITX – Lucena',
    checkpoints: [
      leg('pitx', 0),
      leg('alabang', 42),
      leg('turbina', 38),
      leg('santoTomas', 26),
      leg('lucena', 135),
    ],
  },
  {
    name: 'Lipa – PITX',
    checkpoints: [
      leg('lipa', 0),
      leg('tanauan', 32),
      leg('santoTomas', 15),
      leg('turbina', 24),
      leg('alabang', 42),
      leg('pitx', 41),
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
  { plateNumber: 'SBL 4820', operatorName: 'Southbound Lines' },
  { plateNumber: 'NRT 5507', operatorName: 'Northline Express' },
  { plateNumber: 'SBL 6631', operatorName: 'Southbound Lines' },
  { plateNumber: 'NRT 3140', operatorName: 'Northline Express' },
  { plateNumber: 'NRT 6712', operatorName: 'Northline Express' },
  { plateNumber: 'NRT 9284', operatorName: 'Northline Express' },
  { plateNumber: 'SBL 2255', operatorName: 'Southbound Lines' },
  { plateNumber: 'SBL 4471', operatorName: 'Southbound Lines' },
  { plateNumber: 'SBL 8806', operatorName: 'Southbound Lines' },
  { plateNumber: 'SBL 1390', operatorName: 'Southbound Lines' },
  { plateNumber: 'SBL 7024', operatorName: 'Southbound Lines' },
];

/**
 * Trips described by what the board should show, not by raw timestamps. Each
 * confirm is [checkpoint, minutes ago]; the engine works out whether that adds
 * up to early, late or quiet.
 */
/**
 * Trips described by what the board should show, not by raw timestamps.
 *
 * Each confirm is [stop, minutes ago]. The engine derives whether that adds up
 * to early, late or quiet, so these numbers are chosen against the measured
 * baselines above — change a baseline and these need retuning with it.
 */
const TRIPS = [
  // ---------------------------------------------------------- Cubao – Baguio
  {
    route: 'Cubao – Baguio',
    bus: 'NRT 8821',
    conductor: 'rey',
    departedAgo: 60,
    confirms: [['Balintawak Interchange', 29]], // 31 min in against a 29 baseline
    note: 'past Balintawak, near enough on time',
  },
  {
    route: 'Cubao – Baguio',
    bus: 'NRT 4416',
    conductor: 'marlon',
    departedAgo: 205,
    confirms: [
      ['Balintawak Interchange', 174],
      ['Victory Liner Tarlac Terminal', 36],
    ],
    left: ['Victory Liner Tarlac Terminal', 34],
    load: ['few', 34],
    delay: ['traffic', 45],
    note: 'left Tarlac filling up, running late',
  },
  {
    route: 'Cubao – Baguio',
    bus: 'NRT 2093',
    conductor: 'rey',
    scheduledInMinutes: 45,
    note: 'still at Araneta, boarding',
  },

  // ------------------------------------------------------------- PITX – Lipa
  {
    route: 'PITX – Lipa',
    bus: 'SBL 1174',
    conductor: 'dennis',
    departedAgo: 55,
    confirms: [['Alabang South Station', 13]], // 42 min in against a 42 baseline
    // No pull-out reported: standing at Alabang, and the board should tell
    // anyone waiting there to hurry.
    note: 'AT Alabang, boarding right now',
  },
  {
    route: 'PITX – Lipa',
    bus: 'SBL 3308',
    conductor: 'joel',
    departedAgo: 120,
    confirms: [
      ['Alabang South Station', 74, 4],
      ['Turbina Bus Terminal', 32, 5],
    ],
    left: ['Turbina Bus Terminal', 29],
    load: ['full', 29],
    delay: ['loading', 25],
    note: 'left Turbina FULL, and crawling — most of its lost time is traffic',
  },
  {
    route: 'PITX – Lipa',
    bus: 'SBL 5629',
    conductor: 'dennis',
    departedAgo: 130,
    confirms: [
      ['Alabang South Station', 90],
      ['Turbina Bus Terminal', 55, 6],
      ['SM Santo Tomas Terminal', 30, 3],
      ['Tanauan City Transport Terminal', 14],
    ],
    left: ['Tanauan City Transport Terminal', 10],
    load: ['seats', 10],
    note: 'held up by traffic, but not its own fault — should not read delayed',
  },
  {
    route: 'PITX – Lipa',
    bus: 'SBL 7742',
    conductor: 'joel',
    // Confirmed Santo Tomas and nothing since. The next leg is 17 minutes, so
    // this is far past its grace window and must be flagged, not guessed at.
    departedAgo: 240,
    confirms: [
      ['Alabang South Station', 192],
      ['Turbina Bus Terminal', 152],
      ['SM Santo Tomas Terminal', 126],
    ],
    note: 'quiet since Santo Tomas — should read as unconfirmed',
  },
  {
    route: 'PITX – Lipa',
    bus: 'SBL 9015',
    conductor: 'marlon',
    departedAgo: 178,
    confirms: [
      ['Alabang South Station', 133],
      ['Turbina Bus Terminal', 94],
      ['SM Santo Tomas Terminal', 68],
      ['Tanauan City Transport Terminal', 51],
    ],
    arrivedAgo: 18,
    note: 'just arrived — still on the stand at Lipa',
  },

  // ------------------------------------------------- the way back
  // A terminal is a turnaround, not the end of the line. This is the same
  // physical bus that just got in, going back out as a separate trip on the
  // reverse route.
  {
    route: 'Lipa – PITX',
    bus: 'SBL 9015',
    conductor: 'marlon',
    scheduledInMinutes: 25,
    note: 'turnaround — the bus that just arrived goes back to PITX',
  },
  {
    route: 'Lipa – PITX',
    bus: 'SBL 4820',
    conductor: 'joel',
    departedAgo: 95,
    confirms: [
      ['Tanauan City Transport Terminal', 59],
      ['SM Santo Tomas Terminal', 44],
      ['Turbina Bus Terminal', 16],
    ],
    left: ['Turbina Bus Terminal', 13],
    load: ['few', 13],
    note: 'northbound to PITX, past Turbina',
  },
  {
    // On the shared trunk: appears on the PITX, Alabang, Turbina and Santo
    // Tomas boards alongside the Lipa buses, then goes somewhere else entirely.
    route: 'PITX – Lucena',
    bus: 'SBL 6631',
    conductor: 'dennis',
    departedAgo: 85,
    confirms: [
      ['Alabang South Station', 41],
      ['Turbina Bus Terminal', 3],
    ],
    load: ['seats', 3],
    note: 'branches east at Santo Tomas — shares the trunk with the Lipa runs',
  },
  {
    route: 'Baguio – Cubao',
    bus: 'NRT 5507',
    conductor: 'rey',
    scheduledInMinutes: 40,
    note: 'southbound departure from Baguio',
  },
  /* ------------------------------------------------------------ second wave
   * The first twelve trips each demonstrate one behaviour. These exist for a
   * different reason: so that whichever pair of stops someone picks in the
   * journey search, there is a bus somewhere on that stretch rather than an
   * empty result. They are spread along each route and staggered in time.
   */

  // --------------------------------------------------------- Cubao – Baguio
  {
    route: 'Cubao – Baguio',
    bus: 'NRT 3140',
    conductor: 'rey',
    departedAgo: 150,
    confirms: [
      ['Balintawak Interchange', 121],
      ['Victory Liner Tarlac Terminal', 0],
    ],
    note: 'just reached Tarlac, most of the route still ahead',
  },
  {
    route: 'Cubao – Baguio',
    bus: 'NRT 6712',
    conductor: 'marlon',
    scheduledInMinutes: 95,
    note: 'later Baguio departure, still boarding at Araneta',
  },

  // --------------------------------------------------------- Baguio – Cubao
  {
    route: 'Baguio – Cubao',
    bus: 'NRT 9284',
    conductor: 'joel',
    departedAgo: 170,
    confirms: [
      ['TPLEX – Rosario Exit', 95], // 75 min in against a 71 baseline
      ['Victory Liner Tarlac Terminal', 5], // 165 against 160
    ],
    note: 'southbound, past Tarlac and heading for Balintawak',
  },

  // ------------------------------------------------------------ PITX – Lipa
  {
    route: 'PITX – Lipa',
    bus: 'SBL 2255',
    conductor: 'dennis',
    departedAgo: 22,
    confirms: [],
    load: ['seats', 20],
    note: 'just left PITX, whole southbound run still ahead',
  },
  {
    route: 'PITX – Lipa',
    bus: 'SBL 4471',
    conductor: 'joel',
    departedAgo: 90,
    confirms: [
      ['Alabang South Station', 42], // 48 min in against a 42 baseline
      ['Turbina Bus Terminal', 4], // 86 against 80
    ],
    left: ['Turbina Bus Terminal', 1],
    note: 'mid-route, between Turbina and Santo Tomas',
  },
  {
    route: 'PITX – Lipa',
    bus: 'SBL 8806',
    conductor: 'marlon',
    scheduledInMinutes: 35,
    note: 'next PITX southbound departure',
  },

  // ------------------------------------------------------------ Lipa – PITX
  {
    route: 'Lipa – PITX',
    bus: 'SBL 1390',
    conductor: 'rey',
    departedAgo: 40,
    confirms: [['Tanauan City Transport Terminal', 5]], // 35 min in against 32
    load: ['few', 6],
    note: 'northbound, just past Tanauan',
  },

  // ---------------------------------------------------------- PITX – Lucena
  {
    route: 'PITX – Lucena',
    bus: 'SBL 7024',
    conductor: 'dennis',
    departedAgo: 150,
    confirms: [
      ['Alabang South Station', 105], // 45 min in against a 42 baseline
      ['Turbina Bus Terminal', 68], // 82 against 80
      ['SM Santo Tomas Terminal', 40], // 110 against 106
    ],
    note: 'past Santo Tomas, on the long leg to Lucena',
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
      for (const [name, ago, trafficMinutes] of spec.confirms ?? []) {
        // A third value is how much of that leg was congestion everyone on the
        // road shared. Live, `stampConditions` fills this in from the traffic
        // provider at the moment a conductor confirms; the seed states it,
        // because the provider's cache lives in the server process and this
        // one has no way to reach it.
        push('passed_checkpoint', minutesAgo(ago), {
          checkpoint: idFor(name),
          ...(trafficMinutes ? { trafficAllowanceMinutes: trafficMinutes } : {}),
        });
      }
      if (spec.load) {
        push('load_report', minutesAgo(spec.load[1]), { load: spec.load[0] });
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
    // Insertion order, so the summary lines up with TRIPS above.
    .sort({ _id: 1 })
    .lean();

  console.log(`\nTrips  ${summary.length}`);
  // Matched by position, not plate: a bus doing a turnaround has two trips,
  // and looking up by plate would report the first one twice.
  for (const [i, spec] of TRIPS.entries()) {
    const t = summary[i];
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
