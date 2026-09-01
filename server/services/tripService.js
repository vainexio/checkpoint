import { CheckpointLog, Trip } from '../models/index.js';
import {
  addMinutes,
  computeTripState,
  cumulativeBaseline,
  evaluateStaleness,
} from './etaEngine.js';
import { getAdjustments, getSegmentDetail } from './trafficProvider.js';

/**
 * The bridge between the pure ETA engine and the database.
 *
 * Every write path funnels through `recomputeTrip`: append a log, then replay
 * the trip's whole history. Nothing mutates trip state incrementally, which is
 * what lets a batch of offline logs land in any order and still settle on the
 * right answer.
 */

/** Append a log and recompute the trip from its full history. */
export async function recordLogs(tripId, logDocs) {
  if (logDocs.length) {
    // ordered:false so one duplicate clientLogId in a synced batch does not
    // abort the rest of the queue.
    try {
      await CheckpointLog.insertMany(logDocs, { ordered: false });
    } catch (err) {
      // E11000 means the device retried a log we already have — that is the
      // idempotency key doing its job, not a failure.
      const isDuplicateOnly =
        err.code === 11000 ||
        (Array.isArray(err.writeErrors) && err.writeErrors.every((e) => e.err?.code === 11000));
      if (!isDuplicateOnly) throw err;
    }
  }
  return recomputeTrip(tripId);
}

/** Replay every log for a trip and persist the resulting state. */
export async function recomputeTrip(tripId) {
  const trip = await Trip.findById(tripId);
  if (!trip) throw Object.assign(new Error('Trip not found'), { status: 404 });

  const logs = await CheckpointLog.find({ trip: trip._id }).sort({ reportedAt: 1 }).lean();

  const state = computeTripState({
    plan: trip.plan,
    logs,
    cancelled: trip.status === 'cancelled',
  });

  trip.status = state.status;
  trip.actualDeparture = state.actualDeparture;
  trip.actualArrival = state.actualArrival;
  trip.lastConfirmedCheckpoint = state.lastConfirmedCheckpoint;
  trip.lastConfirmedAt = state.lastConfirmedAt;
  trip.cumulativeVarianceMinutes = state.cumulativeVarianceMinutes;
  trip.computedETAs = state.computedETAs;
  trip.finalVarianceMinutes = state.finalVarianceMinutes;

  await trip.save();
  return { trip, state, logs };
}

/**
 * Shape a trip for any consumer, deriving staleness at read time.
 *
 * Staleness is never read from storage. A trip goes stale purely by the passage
 * of time, with no write to trigger an update — so it is computed here, on
 * every single read, against the caller's clock.
 */
export function presentTrip(trip, { logs = [], now = new Date(), audience = 'public' } = {}) {
  const plan = trip.plan;

  // Traffic is applied when a trip is *read*, never when it is stored. What we
  // persist is what we measured — departure, confirmed checkpoints, variance —
  // and that must not drift because a road was busy at write time. The live
  // adjustment is a view over those facts, recomputed on every read from
  // whatever the cache currently knows.
  const trafficAdjustments = getAdjustments(now.getTime?.() ?? Date.now());

  const state = computeTripState({
    plan,
    logs,
    cancelled: trip.status === 'cancelled',
    trafficAdjustments,
  });
  const staleness = evaluateStaleness({ plan, state, now, trafficAdjustments });

  const etaByCheckpoint = new Map(
    state.computedETAs.map((e) => [String(e.checkpoint), e])
  );

  const stops = plan.map((entry, index) => {
    const eta = etaByCheckpoint.get(String(entry.checkpoint));
    return {
      checkpointId: String(entry.checkpoint),
      name: entry.name,
      type: entry.type,
      baselineMinutesFromPrevious: entry.baselineMinutesFromPrevious,
      projectedArrival: eta?.projectedArrival ?? null,
      // What the timetable promises: the scheduled departure plus the baseline.
      // It is the only thing that can be said about a trip that has not left
      // yet, and it is kept separate from projectedArrival so a scheduled time
      // is never mistaken for one derived from a real observation.
      scheduledArrival: addMinutes(
        trip.scheduledDeparture,
        cumulativeBaseline(plan, index)
      ),
      actualArrival: eta?.actualArrival ?? null,
      progress: eta?.progress ?? 'pending',
      // Minutes this stop has moved because of live traffic on the road still
      // ahead of the bus. Zero when no provider is configured.
      trafficMinutes: eta?.trafficMinutes ?? 0,
    };
  });

  const lastConfirmed =
    state.lastConfirmedIndex >= 0 ? plan[state.lastConfirmedIndex] : null;

  const base = {
    id: String(trip._id),
    status: state.status,
    route: {
      id: String(trip.route?._id ?? trip.route),
      name: trip.route?.name ?? null,
    },
    bus: trip.bus?.plateNumber
      ? { plateNumber: trip.bus.plateNumber, operatorName: trip.bus.operatorName }
      : null,
    scheduledDeparture: trip.scheduledDeparture,
    actualDeparture: state.actualDeparture,
    actualArrival: state.actualArrival,
    varianceMinutes: state.cumulativeVarianceMinutes,
    lastConfirmedCheckpoint: lastConfirmed
      ? { checkpointId: String(lastConfirmed.checkpoint), name: lastConfirmed.name }
      : null,
    lastConfirmedAt: state.lastConfirmedAt,
    nextCheckpoint: staleness.nextCheckpointName
      ? { checkpointId: String(staleness.nextCheckpoint), name: staleness.nextCheckpointName }
      : null,
    isStale: staleness.isStale,
    minutesSinceLastConfirm: staleness.minutesSinceLastConfirm,
    latestDelay: state.latestDelay,
    traffic: buildTrafficNote(plan, state, now),
    stops,
  };

  if (audience === 'public') return base;

  // Operators and conductors get the working detail; guests never see internal
  // bookkeeping or raw identifiers beyond what the board needs.
  return {
    ...base,
    conductor: trip.conductor?.name
      ? { id: String(trip.conductor._id), name: trip.conductor.name }
      : trip.conductor
        ? { id: String(trip.conductor) }
        : null,
    finalVarianceMinutes: state.finalVarianceMinutes,
    exactVarianceMinutes: state.exactVarianceMinutes,
    ignoredLogs: state.ignoredLogs,
    expectedAtNextCheckpoint: staleness.expectedAtNextCheckpoint,
    staleAfter: staleness.staleAfter,
  };
}

/**
 * A plain-language note about the road immediately ahead, or null when there is
 * nothing worth saying. Small fluctuations are noise; a passenger only needs to
 * hear about traffic when it actually moves their bus.
 */
function buildTrafficNote(plan, state, now) {
  const nextIndex = state.lastConfirmedIndex + 1;
  if (nextIndex <= 0 || nextIndex >= plan.length) return null;

  const detail = getSegmentDetail(
    plan[nextIndex - 1].checkpoint,
    plan[nextIndex].checkpoint,
    now.getTime?.() ?? Date.now()
  );
  if (!detail || Math.abs(detail.adjustmentMinutes) < 3) return null;

  return {
    segment: `${plan[nextIndex - 1].name} → ${plan[nextIndex].name}`,
    adjustmentMinutes: detail.adjustmentMinutes,
    source: detail.source,
    checkedAt: new Date(detail.fetchedAt),
  };
}

/** Load trips plus their logs in two queries, then present each one. */
export async function presentTrips(trips, options = {}) {
  if (!trips.length) return [];
  const ids = trips.map((t) => t._id);
  const logs = await CheckpointLog.find({ trip: { $in: ids } }).sort({ reportedAt: 1 }).lean();

  const byTrip = new Map();
  for (const l of logs) {
    const key = String(l.trip);
    if (!byTrip.has(key)) byTrip.set(key, []);
    byTrip.get(key).push(l);
  }

  return trips.map((trip) =>
    presentTrip(trip, { ...options, logs: byTrip.get(String(trip._id)) ?? [] })
  );
}

export const TRIP_POPULATE = [
  { path: 'route', select: 'name origin destination' },
  { path: 'bus', select: 'plateNumber operatorName' },
  { path: 'conductor', select: 'name username' },
];
