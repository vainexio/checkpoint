import { Checkpoint, CheckpointLog, Route, Trip } from '../models/index.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { presentTrip, presentTrips, TRIP_POPULATE } from '../services/tripService.js';

/**
 * Guest-facing reads. No auth middleware touches any of these — a passenger at
 * a terminal should be able to check a bus without an account, a download, or
 * a login screen in the way.
 */

const ACTIVE_STATUSES = ['scheduled', 'in_transit', 'delayed'];

/**
 * How long a finished bus stays on its destination board.
 *
 * It is still physically parked there, and someone meeting a passenger needs
 * to see that it landed — the same reason an airport board keeps arrived
 * flights up for a while rather than erasing them on touchdown.
 */
const RECENTLY_ARRIVED_MINUTES = 45;

/** Stations only. Landmarks are timing points; they get no board. */
export const listStations = asyncHandler(async (req, res) => {
  const stations = await Checkpoint.find({ type: 'station' }).sort({ name: 1 }).lean();
  res.json(stations.map(toPublicCheckpoint));
});

const toPublicCheckpoint = (c) => ({
  id: String(c._id),
  name: c.name,
  type: c.type,
  area: c.area || null,
  isTerminal: c.isTerminal,
  location: c.location?.lat != null ? { lat: c.location.lat, lng: c.location.lng } : null,
});

/**
 * Everything the map needs in one request: every checkpoint that has been
 * placed, plus each route as an ordered list of them so the client can draw the
 * line a bus follows.
 *
 * These are fixed places encoded by an operator, not vehicle positions — there
 * is nothing live on this map, and that is the point.
 */
export const mapData = asyncHandler(async (req, res) => {
  const [checkpoints, routes] = await Promise.all([
    Checkpoint.find({ 'location.lat': { $ne: null } }).lean(),
    Route.find({ isActive: true }).populate('checkpoints.checkpoint', 'name type location').lean(),
  ]);

  res.json({
    checkpoints: checkpoints.map(toPublicCheckpoint),
    routes: routes.map((r) => ({
      id: String(r._id),
      name: r.name,
      path: r.checkpoints
        .map((entry) => entry.checkpoint)
        .filter((cp) => cp?.location?.lat != null)
        .map((cp) => ({
          id: String(cp._id),
          name: cp.name,
          type: cp.type,
          location: { lat: cp.location.lat, lng: cp.location.lng },
        })),
    })),
  });
});

/** Straight-line distance in km. Good enough to rank what is walkable. */
function distanceKm(a, b) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * How far a stop can be and still honestly be called "near you".
 *
 * Roughly a short ride: far enough to include the terminal across town, close
 * enough that getting there is not itself a journey. Sorting by distance alone
 * is not enough — with only a handful of stops in the database the closest one
 * can be 60 km away, and calling that "nearest to you" is technically true and
 * practically a lie.
 */
const NEARBY_RADIUS_KM = 25;

export const nearbyStations = asyncHandler(async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: 'A valid lat and lng are required.' });
  }

  const stations = await Checkpoint.find({
    type: 'station',
    'location.lat': { $ne: null },
  }).lean();

  const ranked = stations
    .map((s) => ({
      ...toPublicCheckpoint(s),
      distanceKm: Math.round(distanceKm({ lat, lng }, s.location) * 10) / 10,
    }))
    .sort((a, b) => a.distanceKm - b.distanceKm);

  const within = ranked.filter((s) => s.distanceKm <= NEARBY_RADIUS_KM);

  res.json({
    from: { lat, lng },
    radiusKm: NEARBY_RADIUS_KM,
    // Genuinely nearby, if anything is.
    within: within.slice(0, Number(req.query.limit) || 8),
    // When nothing is, say so and offer the closest anyway — labelled for what
    // it is, rather than dressed up as "near".
    fallback: within.length ? [] : ranked.slice(0, 3),
  });
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
    status: { $in: [...ACTIVE_STATUSES, 'arrived'] },
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
    /**
     * A terminal board has to answer three questions, not one: what is coming,
     * what is sitting here, and what has just got in. Showing only the first
     * leaves a bus parked at the stand invisible to the people standing next
     * to it.
     */
    .filter(({ trip, stop, index }) => {
      if (!stop) return false;

      if (trip.status === 'arrived') {
        // Only at the end of its own route, and only while it is plausibly
        // still on the stand.
        const isDestination = index === trip.stops.length - 1;
        const minutesSince = trip.actualArrival
          ? (Date.now() - new Date(trip.actualArrival).getTime()) / 60000
          : Infinity;
        return isDestination && minutesSince <= RECENTLY_ARRIVED_MINUTES;
      }

      // Still ahead of the bus, or the bus is standing at this very stop —
      // dropping that second case would hide it from the one person who can
      // still catch it.
      return (
        stop.progress === 'pending' ||
        (trip.position === 'at_stop' &&
          trip.lastConfirmedCheckpoint?.checkpointId === stop.checkpointId)
      );
    })
    .map(({ trip, stop, index }) => {
      const lastPassed = trip.stops.reduce(
        (acc, s, i) => (s.progress === 'passed' ? i : acc),
        -1
      );
      const isDeparture = index === 0 && !trip.actualDeparture;
      const hasArrived = trip.status === 'arrived';
      const isHereNow =
        trip.position === 'at_stop' &&
        trip.lastConfirmedCheckpoint?.checkpointId === stop.checkpointId;

      /**
       * What this row *is* from this stop's point of view. The same trip is a
       * departure at its origin and an arrival everywhere else, and showing an
       * "expected arrival" for a bus parked at its own starting terminal is
       * simply the wrong sentence.
       */
      const boardKind = hasArrived
        ? 'arrived'
        : isDeparture
          ? 'departure'
          : 'arrival';

      const boardTime = hasArrived
        ? stop.actualArrival
        : isDeparture
          ? trip.scheduledDeparture
          : (stop.actualArrival ?? stop.projectedArrival ?? stop.scheduledArrival);

      return {
        tripId: trip.id,
        route: trip.route.name,
        boardKind,
        boardTime,
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
        eta: stop.actualArrival ?? stop.projectedArrival,
        scheduledEta: stop.scheduledArrival,
        stopsAway: lastPassed >= 0 ? index - lastPassed : null,
        isOrigin: index === 0,
        traffic: trip.traffic,

        // Where the bus actually is: standing at a stop, or on the road.
        nextCheckpoint: trip.nextCheckpoint,
        position: trip.position,
        leftLastCheckpointAt: trip.leftLastCheckpointAt,
        load: trip.load,
        loadReportedAt: trip.loadReportedAt,
        loadReportedAtName: trip.loadReportedAtName,
        // Standing at *this* stop, not merely somewhere on the route.
        isHereNow,

        /**
         * Enough of the route to answer the two questions someone who does not
         * know the area actually has: where is this bus now, and is it going
         * anywhere useful to me?
         *
         * The bus is carried as either `isBusHere` (standing at a stop, doors
         * possibly open) or `isHeadingHere` (on the leg into the next point).
         * Those are genuinely different situations for someone waiting: one
         * means run, the other means settle in — so the strip never has to
         * guess which it is showing.
         */
        journey: trip.stops.map((s, i) => ({
          name: s.name,
          type: s.type,
          progress: s.progress,
          eta: s.projectedArrival ?? s.scheduledArrival,
          isLastConfirmed: i === lastPassed,
          // The bus is standing at this one right now.
          isBusHere: i === lastPassed && trip.position === 'at_stop',
          // The bus is on the road heading into this one.
          isHeadingHere:
            i === lastPassed + 1 &&
            trip.position === 'between' &&
            !!trip.actualDeparture &&
            trip.status !== 'arrived',
          isYourStop: i === index,
        })),
        continuesTo: trip.stops
          .slice(index + 1)
          .filter((s) => s.type === 'station')
          .map((s) => s.name),
      };
    })
    .sort((a, b) => {
      // Here now, then everything due, then what has already got in.
      const rank = (x) => (x.isHereNow ? 0 : x.boardKind === 'arrived' ? 2 : 1);
      if (rank(a) !== rank(b)) return rank(a) - rank(b);
      if (!a.boardTime) return 1;
      if (!b.boardTime) return -1;
      // Arrived buses read newest first; everything else soonest first.
      const dir = a.boardKind === 'arrived' ? -1 : 1;
      return dir * (new Date(a.boardTime) - new Date(b.boardTime));
    });

  res.json({
    station: {
      id: String(station._id),
      name: station.name,
      area: station.area || null,
      isTerminal: station.isTerminal,
      location:
        station.location?.lat != null
          ? { lat: station.location.lat, lng: station.location.lng }
          : null,
    },
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
