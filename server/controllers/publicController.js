import { Checkpoint, CheckpointLog, Route, Trip } from '../models/index.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { presentTrip, presentTrips, TRIP_POPULATE } from '../services/tripService.js';

/**
 * Guest-facing reads. No auth middleware touches any of these — a passenger at
 * a terminal should be able to check a bus without an account, a download, or
 * a login screen in the way.
 */

const ACTIVE_STATUSES = ['scheduled', 'in_transit', 'delayed'];

/** Stations only. Landmarks are timing points; they get no board. */
export const listStations = asyncHandler(async (req, res) => {
  const stations = await Checkpoint.find({ type: 'station' }).sort({ name: 1 }).lean();
  res.json(
    stations.map((s) => ({
      id: String(s._id),
      name: s.name,
      isTerminal: s.isTerminal,
    }))
  );
});

export const listRoutes = asyncHandler(async (req, res) => {
  const routes = await Route.find({ isActive: true })
    .populate('origin destination', 'name')
    .sort({ name: 1 })
    .lean();

  res.json(
    routes.map((r) => ({
      id: String(r._id),
      name: r.name,
      origin: r.origin?.name ?? null,
      destination: r.destination?.name ?? null,
      stopCount: r.checkpoints.length,
    }))
  );
});

/**
 * Every bus currently heading for one station, soonest first — the arrivals
 * board. A trip appears here while the station is still ahead of it and drops
 * off once it has been confirmed passed.
 */
export const stationBoard = asyncHandler(async (req, res) => {
  const station = await Checkpoint.findById(req.params.stationId).lean();
  if (!station || station.type !== 'station') {
    return res.status(404).json({ error: 'Station not found.' });
  }

  const trips = await Trip.find({
    status: { $in: ACTIVE_STATUSES },
    'plan.checkpoint': station._id,
  })
    .populate(TRIP_POPULATE)
    .lean();

  const presented = await presentTrips(trips, { audience: 'public' });

  const inbound = presented
    .map((trip) => {
      const stop = trip.stops.find((s) => s.checkpointId === String(station._id));
      const index = trip.stops.findIndex((s) => s.checkpointId === String(station._id));
      return { trip, stop, index };
    })
    // Already confirmed past this station, or skipped it — no longer inbound.
    .filter(({ stop }) => stop && stop.progress === 'pending')
    .map(({ trip, stop, index }) => {
      const lastPassed = trip.stops.reduce(
        (acc, s, i) => (s.progress === 'passed' ? i : acc),
        -1
      );
      return {
        tripId: trip.id,
        route: trip.route.name,
        origin: trip.stops[0]?.name ?? null,
        destination: trip.stops.at(-1)?.name ?? null,
        bus: trip.bus,
        status: trip.status,
        isStale: trip.isStale,
        minutesSinceLastConfirm: trip.minutesSinceLastConfirm,
        varianceMinutes: trip.varianceMinutes,
        scheduledDeparture: trip.scheduledDeparture,
        lastConfirmedCheckpoint: trip.lastConfirmedCheckpoint,
        lastConfirmedAt: trip.lastConfirmedAt,
        latestDelay: trip.latestDelay,
        // The number the whole screen exists to show. Before departure there is
        // no projection to give, only what the timetable says.
        eta: stop.projectedArrival,
        scheduledEta: stop.scheduledArrival,
        stopsAway: lastPassed >= 0 ? index - lastPassed : null,
        isOrigin: index === 0,
      };
    })
    .sort((a, b) => {
      if (!a.eta) return 1;
      if (!b.eta) return -1;
      return new Date(a.eta) - new Date(b.eta);
    });

  res.json({
    station: { id: String(station._id), name: station.name, isTerminal: station.isTerminal },
    generatedAt: new Date(),
    arrivals: inbound,
  });
});

/** Everything currently moving, for the all-routes overview. */
export const listActiveTrips = asyncHandler(async (req, res) => {
  const filter = { status: { $in: ACTIVE_STATUSES } };
  if (req.query.routeId) filter.route = req.query.routeId;

  const trips = await Trip.find(filter)
    .populate(TRIP_POPULATE)
    .sort({ scheduledDeparture: 1 })
    .lean();

  res.json({
    generatedAt: new Date(),
    trips: await presentTrips(trips, { audience: 'public' }),
  });
});

export const tripDetail = asyncHandler(async (req, res) => {
  const trip = await Trip.findById(req.params.tripId).populate(TRIP_POPULATE).lean();
  if (!trip) return res.status(404).json({ error: 'Trip not found.' });

  const logs = await CheckpointLog.find({ trip: trip._id }).sort({ reportedAt: 1 }).lean();

  res.json({
    generatedAt: new Date(),
    trip: presentTrip(trip, { logs, audience: 'public' }),
  });
});
