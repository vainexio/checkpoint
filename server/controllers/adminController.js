import { Bus, Checkpoint, CheckpointLog, Route, Trip, User } from '../models/index.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { buildPlan } from '../services/etaEngine.js';
import { presentTrip, presentTrips, TRIP_POPULATE } from '../services/tripService.js';

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
    conductor.passwordHash = await User.hashPassword(req.body.password);
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
  const removed = await User.findOneAndDelete({ _id: req.params.id, role: 'conductor' });
  if (!removed) return res.status(404).json({ error: 'Conductor not found.' });
  res.status(204).end();
});

/* ----------------------------------------------------------------------- trips */

export const listTrips = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.routeId) filter.route = req.query.routeId;

  const trips = await Trip.find(filter)
    .populate(TRIP_POPULATE)
    .sort({ scheduledDeparture: -1 })
    .limit(Number(req.query.limit) || 100)
    .lean();

  res.json({ generatedAt: new Date(), trips: await presentTrips(trips, { audience: 'admin' }) });
});

export const getTrip = asyncHandler(async (req, res) => {
  const trip = await Trip.findById(req.params.id).populate(TRIP_POPULATE).lean();
  if (!trip) return res.status(404).json({ error: 'Trip not found.' });
  const logs = await CheckpointLog.find({ trip: trip._id }).sort({ reportedAt: 1 }).lean();
  res.json({ trip: presentTrip(trip, { logs, audience: 'admin' }), logs });
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
    plan: buildPlan(route),
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
  if (req.body.busId) trip.bus = req.body.busId;
  if (req.body.conductorId) trip.conductor = req.body.conductorId;
  if (req.body.scheduledDeparture) trip.scheduledDeparture = new Date(req.body.scheduledDeparture);
  if (req.body.status === 'cancelled') trip.status = 'cancelled';

  await trip.save();
  const populated = await Trip.findById(trip._id).populate(TRIP_POPULATE).lean();
  const logs = await CheckpointLog.find({ trip: trip._id }).sort({ reportedAt: 1 }).lean();
  res.json({ trip: presentTrip(populated, { logs, audience: 'admin' }) });
});

export const deleteTrip = asyncHandler(async (req, res) => {
  const trip = await Trip.findByIdAndDelete(req.params.id);
  if (!trip) return res.status(404).json({ error: 'Trip not found.' });
  await CheckpointLog.deleteMany({ trip: trip._id });
  res.status(204).end();
});

/* ------------------------------------------------------------------- dashboard */

export const dashboard = asyncHandler(async (req, res) => {
  const trips = await Trip.find({ status: { $in: ['scheduled', 'in_transit', 'delayed'] } })
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
