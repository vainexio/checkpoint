import {
  Bus,
  Checkpoint,
  CheckpointLog,
  Route,
  Schedule,
  Trip,
  TripCorrection,
  User,
} from '../models/index.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { buildPlan } from '../services/etaEngine.js';
import { presentTrip, presentTrips, TRIP_POPULATE } from '../services/tripService.js';
import {
  addDays,
  GENERATION_DAYS,
  manilaDate,
  reapplySchedule,
  removeUntouchedFutureTrips,
} from '../services/scheduleService.js';
import { liveWindow } from '../services/tripWindow.js';
import { tripRecord } from './correctionController.js';
import { issueResetCode, RESET_CODE_MINUTES } from './authController.js';
import { geocode } from '../services/geocoder.js';
import { canMeasure, measureLegs } from '../services/legMeasurer.js';

/* ------------------------------------------------------------------ geocoding */

/**
 * Look up a place by name so a pin can be dropped without hunting on the map.
 *
 * Admin-only on purpose: this proxies a free community service with a strict
 * rate limit, and exposing it publicly would be the quickest way to get the
 * whole deployment blocked. Costs nothing and is unrelated to the traffic key.
 */
/**
 * Rebuild the demo data, for refreshing a live demonstration.
 *
 * Admin only, because it empties the trip collection: an unauthenticated
 * endpoint that wipes the database is a hole, however quiet the button that
 * calls it.
 *
 * The rebuild is started rather than awaited. It takes the better part of a
 * minute against a remote database, and a request held open that long is at
 * the mercy of every timeout between the server and the browser — measured
 * here failing on the client while the rebuild itself completed perfectly.
 * The caller polls the companion endpoint instead, so the connection is never
 * the thing that has to survive.
 */
let reseedState = { running: false, finishedAt: null, error: null, trips: null };

export const reseedDemoData = asyncHandler(async (req, res) => {
  if (reseedState.running) {
    return res.status(202).json({ status: 'already-running' });
  }

  reseedState = { running: true, finishedAt: null, error: null, trips: null };

  (async () => {
    try {
      const { reseed } = await import('../seed.js');
      const result = await reseed();
      reseedState = {
        running: false,
        finishedAt: new Date(),
        error: null,
        trips: result?.trips ?? null,
      };
    } catch (err) {
      console.error('Reseed failed:', err);
      reseedState = { running: false, finishedAt: new Date(), error: err.message, trips: null };
    }
  })();

  res.status(202).json({ status: 'started' });
});

export const reseedProgress = asyncHandler(async (req, res) => {
  res.json(reseedState);
});

export const geocodePlace = asyncHandler(async (req, res) => {
  try {
    res.json({ results: await geocode(req.query.q, { limit: 6 }) });
  } catch (err) {
    // A failed lookup is not a failed page — clicking the map still works.
    res.json({ results: [], error: 'Place search is unavailable right now.' });
  }
});

/* ---------------------------------------------------------------- checkpoints */

export const listCheckpoints = asyncHandler(async (req, res) => {
  res.json(await Checkpoint.find().sort({ name: 1 }).lean());
});

/** Accept a dropped pin, or no pin at all — placement can come later. */
const readLocation = (body) => {
  const lat = Number(body?.location?.lat);
  const lng = Number(body?.location?.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : { lat: null, lng: null };
};

export const createCheckpoint = asyncHandler(async (req, res) => {
  const { name, type, isTerminal, area } = req.body;
  const checkpoint = await Checkpoint.create({
    name,
    type,
    area: area || '',
    isTerminal: !!isTerminal,
    location: readLocation(req.body),
  });
  res.status(201).json(checkpoint);
});

export const updateCheckpoint = asyncHandler(async (req, res) => {
  const checkpoint = await Checkpoint.findById(req.params.id);
  if (!checkpoint) return res.status(404).json({ error: 'Checkpoint not found.' });

  if (req.body.name !== undefined) checkpoint.name = req.body.name;
  if (req.body.type !== undefined) checkpoint.type = req.body.type;
  if (req.body.area !== undefined) checkpoint.area = req.body.area;
  if (req.body.isTerminal !== undefined) checkpoint.isTerminal = !!req.body.isTerminal;
  // Dragging a pin is the common edit here, so location updates on its own.
  if (req.body.location !== undefined) checkpoint.location = readLocation(req.body);

  await checkpoint.save();
  res.json(checkpoint);
});

export const deleteCheckpoint = asyncHandler(async (req, res) => {
  const inUse = await Route.exists({ 'checkpoints.checkpoint': req.params.id });
  if (inUse) {
    return res.status(409).json({ error: 'This checkpoint is still used by a route.' });
  }
  const removed = await Checkpoint.findByIdAndDelete(req.params.id);
  if (!removed) return res.status(404).json({ error: 'Checkpoint not found.' });
  res.status(204).end();
});

/**
 * Suggest how long each leg of a route being drawn normally takes.
 *
 * Typing a baseline for every leg is the tedious, error-prone part of setting a
 * route up, and a wrong one quietly corrupts every ETA on it. So the system
 * measures the legs and hands back numbers the operator can accept or correct —
 * they know things a routing engine cannot, and the returned values are only a
 * starting point.
 */
export const measureRouteLegs = asyncHandler(async (req, res) => {
  if (!canMeasure()) {
    return res.status(503).json({
      error: 'No traffic provider is configured, so travel times cannot be estimated.',
    });
  }

  const ids = Array.isArray(req.body?.checkpointIds) ? req.body.checkpointIds : [];
  if (ids.length < 2) {
    return res.status(400).json({ error: 'Add at least two stops before estimating times.' });
  }

  const found = await Checkpoint.find({ _id: { $in: ids } }).lean();
  const byId = new Map(found.map((c) => [String(c._id), c]));

  // Ordered as the caller sent them — the order is the route.
  const stops = ids.map((id) => {
    const cp = byId.get(String(id));
    return {
      id: String(id),
      name: cp?.name ?? 'Unknown',
      type: cp?.type ?? 'station',
      location: cp?.location ?? null,
    };
  });

  res.json({ legs: await measureLegs(stops) });
});

/* --------------------------------------------------------------------- routes */

const populateRoute = (query) =>
  query.populate('checkpoints.checkpoint', 'name type isTerminal').populate('origin destination', 'name');

export const listRoutes = asyncHandler(async (req, res) => {
  res.json(await populateRoute(Route.find()).sort({ name: 1 }).lean());
});

export const getRoute = asyncHandler(async (req, res) => {
  const route = await populateRoute(Route.findById(req.params.id)).lean();
  if (!route) return res.status(404).json({ error: 'Route not found.' });
  res.json(route);
});

export const createRoute = asyncHandler(async (req, res) => {
  const route = await Route.create({
    name: req.body.name,
    checkpoints: req.body.checkpoints,
    // origin/destination are derived from the ordered array on validate.
    origin: req.body.checkpoints?.[0]?.checkpoint,
    destination: req.body.checkpoints?.at(-1)?.checkpoint,
  });
  res.status(201).json(await populateRoute(Route.findById(route._id)).lean());
});

export const updateRoute = asyncHandler(async (req, res) => {
  const route = await Route.findById(req.params.id);
  if (!route) return res.status(404).json({ error: 'Route not found.' });

  if (req.body.name !== undefined) route.name = req.body.name;
  if (req.body.checkpoints !== undefined) route.checkpoints = req.body.checkpoints;
  if (req.body.isActive !== undefined) route.isActive = req.body.isActive;

  await route.save();

  // Trips already created keep the plan they were built with. Editing baselines
  // here changes what future trips inherit, never what a running bus is
  // measured against.
  res.json(await populateRoute(Route.findById(route._id)).lean());
});

export const deleteRoute = asyncHandler(async (req, res) => {
  const inUse = await Trip.exists({ route: req.params.id });
  if (inUse) return res.status(409).json({ error: 'This route already has trips.' });
  if (await Schedule.exists({ route: req.params.id })) {
    return res.status(409).json({ error: 'A recurring schedule still runs on this route.' });
  }
  const removed = await Route.findByIdAndDelete(req.params.id);
  if (!removed) return res.status(404).json({ error: 'Route not found.' });
  res.status(204).end();
});

/* ----------------------------------------------------------------------- buses */

export const listBuses = asyncHandler(async (req, res) => {
  res.json(await Bus.find().sort({ plateNumber: 1 }).lean());
});

export const createBus = asyncHandler(async (req, res) => {
  const bus = await Bus.create({
    plateNumber: req.body.plateNumber,
    operatorName: req.body.operatorName,
  });
  res.status(201).json(bus);
});

export const updateBus = asyncHandler(async (req, res) => {
  const bus = await Bus.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  });
  if (!bus) return res.status(404).json({ error: 'Bus not found.' });
  res.json(bus);
});

export const deleteBus = asyncHandler(async (req, res) => {
  const inUse = await Trip.exists({ bus: req.params.id, status: { $ne: 'arrived' } });
  if (inUse) return res.status(409).json({ error: 'This bus has active trips.' });
  if (await Schedule.exists({ bus: req.params.id })) {
    return res.status(409).json({ error: 'A recurring schedule still uses this bus.' });
  }
  const removed = await Bus.findByIdAndDelete(req.params.id);
  if (!removed) return res.status(404).json({ error: 'Bus not found.' });
  res.status(204).end();
});

/* ------------------------------------------------------------------ conductors */

export const listConductors = asyncHandler(async (req, res) => {
  res.json(await User.find({ role: 'conductor' }).sort({ name: 1 }).lean());
});

export const createConductor = asyncHandler(async (req, res) => {
  const { name, username, password } = req.body;
  if (!password || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }
  const conductor = await User.create({
    name,
    username,
    role: 'conductor',
    passwordHash: await User.hashPassword(password),
    // The admin chose this password, so it is a temporary one: the conductor
    // replaces it the first time they sign in.
    mustChangePassword: true,
  });
  res.status(201).json(conductor);
});

export const updateConductor = asyncHandler(async (req, res) => {
  const conductor = await User.findOne({ _id: req.params.id, role: 'conductor' });
  if (!conductor) return res.status(404).json({ error: 'Conductor not found.' });

  if (req.body.name !== undefined) conductor.name = req.body.name;
  if (req.body.username !== undefined) conductor.username = req.body.username;
  if (req.body.isActive !== undefined) conductor.isActive = req.body.isActive;
  if (req.body.password) {
    if (req.body.password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }
    // Set by someone else, so temporary — and it ends the conductor's
    // existing sessions, which is usually the point of resetting it.
    await conductor.setPassword(req.body.password, { mustChange: true });
  }

  await conductor.save();
  res.json(conductor);
});

export const deleteConductor = asyncHandler(async (req, res) => {
  const inUse = await Trip.exists({
    conductor: req.params.id,
    status: { $in: ['scheduled', 'in_transit', 'delayed'] },
  });
  if (inUse) {
    return res.status(409).json({ error: 'This conductor has active trips assigned.' });
  }
  if (await Schedule.exists({ conductor: req.params.id })) {
    return res.status(409).json({ error: 'A recurring schedule still assigns this conductor.' });
  }
  const removed = await User.findOneAndDelete({ _id: req.params.id, role: 'conductor' });
  if (!removed) return res.status(404).json({ error: 'Conductor not found.' });
  res.status(204).end();
});

/* ---------------------------------------------------------------------- admins */

export const listAdmins = asyncHandler(async (req, res) => {
  res.json(await User.find({ role: 'admin' }).sort({ name: 1 }).lean());
});

/**
 * One admin is a single point of failure — forget the password and nobody can
 * help, because the setup route closes as soon as any account exists. So an
 * admin can create another.
 */
export const createAdmin = asyncHandler(async (req, res) => {
  const { name, username, password } = req.body;
  if (!password || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }
  const admin = await User.create({
    name,
    username,
    role: 'admin',
    passwordHash: await User.hashPassword(password),
    mustChangePassword: true,
  });
  res.status(201).json(admin);
});

export const deleteAdmin = asyncHandler(async (req, res) => {
  if (String(req.params.id) === String(req.user._id)) {
    return res.status(409).json({ error: 'You cannot remove your own account.' });
  }
  // Never let the last one go: that would lock everybody out for good.
  if ((await User.countDocuments({ role: 'admin' })) <= 1) {
    return res.status(409).json({ error: 'This is the only admin account. Create another first.' });
  }
  const removed = await User.findOneAndDelete({ _id: req.params.id, role: 'admin' });
  if (!removed) return res.status(404).json({ error: 'Admin not found.' });
  res.status(204).end();
});

/**
 * Give a staff member a way back into their account without the admin ever
 * choosing — or knowing — their new password. The code is shown once, works
 * once, and expires; the person uses it on the sign-in page to set their own.
 */
export const createResetCode = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ error: 'Account not found.' });
  if (!user.isActive) return res.status(409).json({ error: 'This account is switched off.' });

  const { code, expiresAt } = await issueResetCode(user);
  res.status(201).json({
    username: user.username,
    name: user.name,
    code,
    expiresAt,
    validMinutes: RESET_CODE_MINUTES,
  });
});

/* ----------------------------------------------------------------------- trips */

/**
 * The start of a Manila day as an instant. Days are Manila days throughout,
 * because that is the calendar every timetable here is written in.
 */
const manilaMidnight = (ymd) => new Date(`${ymd}T00:00:00+08:00`);

/**
 * Trips by day rather than one long list.
 *
 * Once schedules generate a week ahead, "newest first, 100 of them" opens on
 * next Tuesday and pushes the buses running right now off the page. So the list
 * is asked for by view — today, what is coming, what is done — and each sorts
 * the way it is read: today and upcoming soonest first, the past newest first.
 */
export const listTrips = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.routeId) filter.route = req.query.routeId;
  if (req.query.scheduleId) filter.schedule = req.query.scheduleId;

  const today = manilaDate();
  const startOfToday = manilaMidnight(today);
  const startOfTomorrow = manilaMidnight(addDays(today, 1));
  let sort = { scheduledDeparture: -1 };

  switch (req.query.view) {
    case 'today':
      filter.scheduledDeparture = { $gte: startOfToday, $lt: startOfTomorrow };
      sort = { scheduledDeparture: 1 };
      break;
    case 'upcoming':
      filter.scheduledDeparture = { $gte: startOfTomorrow };
      sort = { scheduledDeparture: 1 };
      break;
    case 'past':
      filter.scheduledDeparture = { $lt: startOfToday };
      break;
    default:
      break;
  }

  const trips = await Trip.find(filter)
    .populate(TRIP_POPULATE)
    .sort(sort)
    .limit(Math.min(Number(req.query.limit) || 100, 300))
    .lean();

  res.json({ generatedAt: new Date(), trips: await presentTrips(trips, { audience: 'admin' }) });
});

/** One trip, with its full log stream and every correction made to it. */
export const getTrip = asyncHandler(async (req, res) => {
  res.json(await tripRecord(req.params.id));
});

/**
 * Schedule a trip. The route's checkpoints and baselines are copied onto the
 * trip here and never re-read, so a later route edit cannot rewrite the
 * yardstick a bus is already being measured against.
 */
export const createTrip = asyncHandler(async (req, res) => {
  const { routeId, busId, conductorId, scheduledDeparture } = req.body;

  const route = await Route.findById(routeId).populate('checkpoints.checkpoint', 'name type');
  if (!route) return res.status(400).json({ error: 'That route does not exist.' });

  const [bus, conductor] = await Promise.all([
    Bus.findById(busId),
    User.findOne({ _id: conductorId, role: 'conductor' }),
  ]);
  if (!bus) return res.status(400).json({ error: 'That bus does not exist.' });
  if (!conductor) return res.status(400).json({ error: 'That conductor does not exist.' });

  const departure = new Date(scheduledDeparture);
  if (Number.isNaN(departure.getTime())) {
    return res.status(400).json({ error: 'scheduledDeparture is not a valid date.' });
  }

  const trip = await Trip.create({
    route: route._id,
    bus: bus._id,
    conductor: conductor._id,
    plan: buildPlan(route, { departure }),
    scheduledDeparture: departure,
    status: 'scheduled',
  });

  const populated = await Trip.findById(trip._id).populate(TRIP_POPULATE).lean();
  res.status(201).json({ trip: presentTrip(populated, { logs: [], audience: 'admin' }) });
});

export const updateTrip = asyncHandler(async (req, res) => {
  const trip = await Trip.findById(req.params.id);
  if (!trip) return res.status(404).json({ error: 'Trip not found.' });

  // The plan is frozen once a trip exists; only assignment and scheduling move.
  const reassigning = Boolean(req.body.busId || req.body.conductorId || req.body.scheduledDeparture);

  if (reassigning && trip.actualDeparture) {
    return res.status(409).json({
      error: 'This trip has already departed. Its bus, conductor and departure are now a record.',
    });
  }

  if (req.body.busId) {
    if (!(await Bus.exists({ _id: req.body.busId }))) {
      return res.status(400).json({ error: 'That bus does not exist.' });
    }
    trip.bus = req.body.busId;
  }
  if (req.body.conductorId) {
    if (!(await User.exists({ _id: req.body.conductorId, role: 'conductor' }))) {
      return res.status(400).json({ error: 'That conductor does not exist.' });
    }
    trip.conductor = req.body.conductorId;
  }
  if (req.body.scheduledDeparture) {
    const departure = new Date(req.body.scheduledDeparture);
    if (Number.isNaN(departure.getTime())) {
      return res.status(400).json({ error: 'scheduledDeparture is not a valid date.' });
    }
    trip.scheduledDeparture = departure;
  }
  if (req.body.status === 'cancelled') trip.status = 'cancelled';

  // One day of a pattern changed by hand. Mark it, so that editing the
  // schedule later regenerates the untouched days and leaves this one alone.
  if (reassigning && trip.schedule) trip.scheduleOverride = true;

  await trip.save();
  const populated = await Trip.findById(trip._id).populate(TRIP_POPULATE).lean();
  const logs = await CheckpointLog.find({ trip: trip._id }).sort({ reportedAt: 1 }).lean();
  res.json({ trip: presentTrip(populated, { logs, audience: 'admin' }) });
});

export const deleteTrip = asyncHandler(async (req, res) => {
  const trip = await Trip.findByIdAndDelete(req.params.id);
  if (!trip) return res.status(404).json({ error: 'Trip not found.' });
  await CheckpointLog.deleteMany({ trip: trip._id });
  await TripCorrection.deleteMany({ trip: trip._id });

  // A generated trip that is deleted outright leaves nothing behind to say the
  // day was taken out, so the next generation run would put it straight back.
  // Record the day on the schedule instead.
  if (trip.schedule && trip.serviceDate) {
    await Schedule.updateOne({ _id: trip.schedule }, { $addToSet: { skipDates: trip.serviceDate } });
  }

  res.status(204).end();
});

/* ------------------------------------------------------------------- schedules */

const SCHEDULE_POPULATE = [
  { path: 'route', select: 'name isActive' },
  { path: 'bus', select: 'plateNumber operatorName' },
  { path: 'conductor', select: 'name username' },
];

/**
 * A schedule as the operator reads it, with what it has actually produced:
 * the next departure it has on the books, and how many are generated ahead.
 */
function presentSchedule(schedule, upcoming = []) {
  const live = upcoming.filter((t) => t.status !== 'cancelled');
  return {
    id: String(schedule._id),
    route: schedule.route
      ? { id: String(schedule.route._id), name: schedule.route.name, isActive: schedule.route.isActive }
      : null,
    bus: schedule.bus
      ? { id: String(schedule.bus._id), plateNumber: schedule.bus.plateNumber }
      : null,
    conductor: schedule.conductor
      ? { id: String(schedule.conductor._id), name: schedule.conductor.name }
      : null,
    departureTime: schedule.departureTime,
    daysOfWeek: schedule.daysOfWeek,
    startDate: schedule.startDate,
    endDate: schedule.endDate,
    skipDates: schedule.skipDates,
    isActive: schedule.isActive,
    nextDeparture: live[0]?.scheduledDeparture ?? null,
    upcomingTrips: live.length,
    cancelledAhead: upcoming.length - live.length,
  };
}

async function upcomingBySchedule(ids) {
  const trips = await Trip.find({ schedule: { $in: ids }, scheduledDeparture: { $gt: new Date() } })
    .select('schedule scheduledDeparture status')
    .sort({ scheduledDeparture: 1 })
    .lean();
  const out = new Map();
  for (const t of trips) {
    const key = String(t.schedule);
    if (!out.has(key)) out.set(key, []);
    out.get(key).push(t);
  }
  return out;
}

async function loadPresentedSchedule(id) {
  const schedule = await Schedule.findById(id).populate(SCHEDULE_POPULATE).lean();
  if (!schedule) return null;
  const upcoming = await upcomingBySchedule([schedule._id]);
  return presentSchedule(schedule, upcoming.get(String(schedule._id)));
}

export const listSchedules = asyncHandler(async (req, res) => {
  const schedules = await Schedule.find()
    .populate(SCHEDULE_POPULATE)
    .sort({ departureTime: 1 })
    .lean();
  const upcoming = await upcomingBySchedule(schedules.map((s) => s._id));
  res.json({
    generationDays: GENERATION_DAYS,
    schedules: schedules.map((s) => presentSchedule(s, upcoming.get(String(s._id)))),
  });
});

/** Check the references a schedule points at, so a typo is a 400 and not a 500. */
async function validateScheduleRefs({ routeId, busId, conductorId }) {
  if (routeId && !(await Route.exists({ _id: routeId }))) return 'That route does not exist.';
  if (busId && !(await Bus.exists({ _id: busId }))) return 'That bus does not exist.';
  if (conductorId && !(await User.exists({ _id: conductorId, role: 'conductor' }))) {
    return 'That conductor does not exist.';
  }
  return null;
}

const toDays = (value) =>
  Array.isArray(value) ? value.map(Number).filter((d) => Number.isInteger(d)) : value;

export const createSchedule = asyncHandler(async (req, res) => {
  const { routeId, busId, conductorId, departureTime, daysOfWeek, startDate, endDate } = req.body;

  if (!routeId || !busId || !conductorId) {
    return res.status(400).json({ error: 'Choose a route, a bus and a conductor.' });
  }
  const problem = await validateScheduleRefs({ routeId, busId, conductorId });
  if (problem) return res.status(400).json({ error: problem });

  const schedule = await Schedule.create({
    route: routeId,
    bus: busId,
    conductor: conductorId,
    departureTime,
    daysOfWeek: toDays(daysOfWeek),
    startDate: startDate || manilaDate(),
    endDate: endDate || null,
  });

  // Generated straight away, so the operator sees the trips it made rather
  // than waiting for the hourly run to find them.
  const { created } = await reapplySchedule(schedule._id);
  res.status(201).json({ schedule: await loadPresentedSchedule(schedule._id), created });
});

/**
 * Change the pattern. Its untouched future trips are regenerated to match;
 * anything already departed, cancelled, logged against, or edited by hand is
 * left exactly as it is.
 */
export const updateSchedule = asyncHandler(async (req, res) => {
  const schedule = await Schedule.findById(req.params.id);
  if (!schedule) return res.status(404).json({ error: 'Schedule not found.' });

  const { routeId, busId, conductorId } = req.body;
  const problem = await validateScheduleRefs({ routeId, busId, conductorId });
  if (problem) return res.status(400).json({ error: problem });

  if (routeId) schedule.route = routeId;
  if (busId) schedule.bus = busId;
  if (conductorId) schedule.conductor = conductorId;
  if (req.body.departureTime !== undefined) schedule.departureTime = req.body.departureTime;
  if (req.body.daysOfWeek !== undefined) schedule.daysOfWeek = toDays(req.body.daysOfWeek);
  if (req.body.startDate !== undefined) schedule.startDate = req.body.startDate || manilaDate();
  if (req.body.endDate !== undefined) schedule.endDate = req.body.endDate || null;
  if (req.body.isActive !== undefined) schedule.isActive = Boolean(req.body.isActive);

  await schedule.save();

  // Paused: clear what it had put on the books, generate nothing new.
  const result = schedule.isActive
    ? await reapplySchedule(schedule._id)
    : { removed: await removeUntouchedFutureTrips(schedule._id), created: 0 };

  res.json({ schedule: await loadPresentedSchedule(schedule._id), ...result });
});

/**
 * Stop a pattern for good. Future trips it generated and nobody touched go
 * with it; everything that already ran, or that someone adjusted by hand,
 * stays — those are records, and a bus someone was told about.
 */
export const deleteSchedule = asyncHandler(async (req, res) => {
  const schedule = await Schedule.findById(req.params.id);
  if (!schedule) return res.status(404).json({ error: 'Schedule not found.' });

  const removed = await removeUntouchedFutureTrips(schedule._id);
  await Schedule.deleteOne({ _id: schedule._id });
  res.json({ removed });
});

/* ------------------------------------------------------------------- dashboard */

export const dashboard = asyncHandler(async (req, res) => {
  // What is running, and what leaves in the next day — not the whole week the
  // schedules have generated, which would bury the buses on the road.
  const trips = await Trip.find({
    status: { $in: ['scheduled', 'in_transit', 'delayed'] },
    ...liveWindow(new Date(), { upcomingHours: 24 }),
  })
    .populate(TRIP_POPULATE)
    .sort({ scheduledDeparture: 1 })
    .lean();

  const presented = await presentTrips(trips, { audience: 'admin' });

  res.json({
    generatedAt: new Date(),
    counts: {
      active: presented.length,
      inTransit: presented.filter((t) => t.status === 'in_transit').length,
      delayed: presented.filter((t) => t.status === 'delayed').length,
      scheduled: presented.filter((t) => t.status === 'scheduled').length,
      // Surfaced on its own because a stale trip is an operational problem —
      // it means a conductor stopped reporting, not that a bus is late.
      stale: presented.filter((t) => t.isStale).length,
    },
    trips: presented,
  });
});
