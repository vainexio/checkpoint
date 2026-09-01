/**
 * CHECKPOINT ETA engine.
 *
 * Pure functions only — no Mongoose, no Express, no clock reads except the
 * `now` you pass in. Everything here takes plain objects and returns plain
 * objects, so the whole engine is unit-testable without a database and can be
 * swapped for a traffic-aware implementation later without touching a
 * controller (see §10: the baseline lookup is the seam).
 *
 * Location in this system comes from confirmed checkpoints, never from
 * coordinates. There is no geolocation anywhere in this file by design.
 */

/** A trip counts as "delayed" once it is running more than this far behind. */
export const DELAY_THRESHOLD_MINUTES = 5;

/**
 * Grace before an unconfirmed trip is called stale, as a fraction of the
 * segment's own baseline. A 20-minute hop goes stale 10 minutes past its
 * expected time; an 80-minute hop gets 40. Long rural segments should not trip
 * the flag as eagerly as short urban ones.
 */
export const STALE_GRACE_RATIO = 0.5;

const MS_PER_MINUTE = 60000;

const idOf = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value._id) return String(value._id);
  return String(value);
};

const toDate = (value) => (value instanceof Date ? value : new Date(value));

export const minutesBetween = (from, to) =>
  (toDate(to).getTime() - toDate(from).getTime()) / MS_PER_MINUTE;

export const addMinutes = (date, minutes) =>
  new Date(toDate(date).getTime() + minutes * MS_PER_MINUTE);

/**
 * Freeze a route's ordered checkpoints onto a trip. Call this once, when the
 * trip is created — never again. `route.checkpoints` must be populated.
 */
export function buildPlan(route) {
  if (!route || !route.checkpoints || !route.checkpoints.length) {
    throw new Error('Cannot build a trip plan from a route with no checkpoints.');
  }
  return route.checkpoints.map((entry, index) => {
    const cp = entry.checkpoint;
    if (!cp || !cp.name) {
      throw new Error('Route checkpoints must be populated before building a plan.');
    }
    return {
      checkpoint: idOf(cp),
      name: cp.name,
      type: cp.type,
      // The origin is the reference point, so its inbound baseline is always 0.
      baselineMinutesFromPrevious: index === 0 ? 0 : entry.baselineMinutesFromPrevious,
    };
  });
}

/** Baseline minutes from the origin through `index`, inclusive. */
export function cumulativeBaseline(plan, index) {
  let total = 0;
  for (let i = 0; i <= index && i < plan.length; i += 1) {
    total += plan[i].baselineMinutesFromPrevious || 0;
  }
  return total;
}

const planIndexOf = (plan, checkpointId) => {
  const target = idOf(checkpointId);
  return plan.findIndex((entry) => idOf(entry.checkpoint) === target);
};

// Logs sharing a timestamp still have a sensible order: you departed before you
// passed anything, and you passed things before you arrived.
const TYPE_RANK = { departed: 0, passed_checkpoint: 1, arrived: 2, delayed: 3 };

const sortLogs = (logs) =>
  [...logs].sort((a, b) => {
    const delta = toDate(a.reportedAt) - toDate(b.reportedAt);
    if (delta !== 0) return delta;
    return (TYPE_RANK[a.type] ?? 9) - (TYPE_RANK[b.type] ?? 9);
  });

/**
 * Replay a trip's entire log history into its current state.
 *
 * State is derived, never accumulated: every call recomputes cumulative
 * variance from the departure time rather than adding segment deltas, so
 * rounding never compounds across a long multi-checkpoint trip. Deriving the
 * whole state this way also makes offline sync trivial — a log that arrives
 * hours late just sorts into position and the trip recomputes correctly,
 * whatever order it reached the server in.
 */
export function computeTripState({
  plan,
  logs = [],
  cancelled = false,
  trafficAdjustments = null,
}) {
  if (!plan || !plan.length) throw new Error('computeTripState requires a trip plan.');

  const lastIndex = plan.length - 1;
  const progress = plan.map((entry) => ({
    checkpoint: entry.checkpoint,
    progress: 'pending',
    actualArrival: null,
  }));

  let actualDeparture = null;
  let actualArrival = null;
  let lastConfirmedIndex = -1;
  let lastConfirmedAt = null;
  let exactVariance = 0;
  let latestDelay = null;
  const ignored = [];

  const skip = (log, reason) =>
    ignored.push({ clientLogId: log.clientLogId ?? null, type: log.type, reason });

  // Variance measured from departure, not from the previous segment.
  const varianceAt = (index, reportedAt) =>
    minutesBetween(actualDeparture, reportedAt) - cumulativeBaseline(plan, index);

  const advanceTo = (index, reportedAt) => {
    // A conductor who forgets a checkpoint and taps the next one still gets
    // correct math — the baseline sum is origin-through-here either way — but
    // the points passed without confirmation should not read as pending.
    for (let i = lastConfirmedIndex + 1; i < index; i += 1) {
      progress[i].progress = 'skipped';
    }
    progress[index].progress = 'passed';
    progress[index].actualArrival = toDate(reportedAt);
    lastConfirmedIndex = index;
    lastConfirmedAt = toDate(reportedAt);
    exactVariance = varianceAt(index, reportedAt);
  };

  for (const log of sortLogs(logs)) {
    switch (log.type) {
      case 'departed': {
        if (actualDeparture) {
          skip(log, 'duplicate_departure');
          break;
        }
        actualDeparture = toDate(log.reportedAt);
        lastConfirmedAt = actualDeparture;
        lastConfirmedIndex = 0;
        exactVariance = 0;
        progress[0].progress = 'passed';
        progress[0].actualArrival = actualDeparture;
        break;
      }

      case 'passed_checkpoint': {
        if (!actualDeparture) {
          skip(log, 'before_departure');
          break;
        }
        if (actualArrival) {
          skip(log, 'after_arrival');
          break;
        }
        const index = planIndexOf(plan, log.checkpoint);
        if (index === -1) {
          skip(log, 'checkpoint_not_on_route');
          break;
        }
        if (index <= lastConfirmedIndex) {
          // Already behind us: a duplicate, or a queued log that lost its race.
          skip(log, 'checkpoint_already_passed');
          break;
        }
        advanceTo(index, log.reportedAt);
        // Passing the final checkpoint is an arrival.
        if (index === lastIndex) actualArrival = toDate(log.reportedAt);
        break;
      }

      case 'arrived': {
        if (!actualDeparture) {
          skip(log, 'before_departure');
          break;
        }
        if (actualArrival) {
          skip(log, 'duplicate_arrival');
          break;
        }
        advanceTo(lastIndex, log.reportedAt);
        actualArrival = toDate(log.reportedAt);
        break;
      }

      case 'delayed': {
        // Informational only. A delay report is not anchored to a measured
        // distance, so it must not move the ETA — it rides alongside the last
        // confirmed checkpoint as context for the number, not an input to it.
        latestDelay = {
          reason: log.delayReason ?? 'other',
          reportedAt: toDate(log.reportedAt),
          nearCheckpoint: lastConfirmedIndex >= 0 ? plan[lastConfirmedIndex].name : null,
        };
        break;
      }

      default:
        skip(log, 'unknown_log_type');
    }
  }

  /**
   * Traffic reported for the road still ahead, summed from the last confirmed
   * point up to `index`.
   *
   * Only the future is adjusted. Variance is a measurement of what already
   * happened — how long the bus actually took against the baseline — and no
   * traffic feed gets to revise a fact we observed. What traffic can do is say
   * the next stretch is running slow, and that belongs in the projection.
   */
  const trafficAheadTo = (index) => {
    if (!trafficAdjustments) return 0;
    let total = 0;
    for (let i = Math.max(lastConfirmedIndex + 1, 1); i <= index; i += 1) {
      const key = `${idOf(plan[i - 1].checkpoint)}->${idOf(plan[i].checkpoint)}`;
      total += trafficAdjustments[key] || 0;
    }
    return total;
  };

  // Project every checkpoint: confirmed ones keep their observed time, and
  // everything still ahead carries the current variance forward.
  const computedETAs = plan.map((entry, index) => {
    const seen = progress[index];
    let projectedArrival = null;
    let trafficMinutes = 0;

    if (actualDeparture) {
      if (seen.progress === 'passed' && seen.actualArrival) {
        projectedArrival = seen.actualArrival;
      } else {
        trafficMinutes = trafficAheadTo(index);
        projectedArrival = addMinutes(
          actualDeparture,
          cumulativeBaseline(plan, index) + exactVariance + trafficMinutes
        );
      }
    }

    return {
      checkpoint: entry.checkpoint,
      projectedArrival,
      progress: seen.progress,
      actualArrival: seen.actualArrival,
      trafficMinutes,
    };
  });

  let status;
  if (cancelled) status = 'cancelled';
  else if (actualArrival) status = 'arrived';
  else if (!actualDeparture) status = 'scheduled';
  else status = exactVariance > DELAY_THRESHOLD_MINUTES ? 'delayed' : 'in_transit';

  return {
    status,
    actualDeparture,
    actualArrival,
    lastConfirmedIndex,
    lastConfirmedCheckpoint:
      lastConfirmedIndex >= 0 ? plan[lastConfirmedIndex].checkpoint : null,
    lastConfirmedAt,
    // Rounded for storage and display; the projections above use the exact
    // value so the clock stays honest.
    cumulativeVarianceMinutes: Math.round(exactVariance),
    exactVarianceMinutes: exactVariance,
    computedETAs,
    finalVarianceMinutes: actualArrival ? Math.round(exactVariance) : null,
    latestDelay,
    ignoredLogs: ignored,
  };
}

/**
 * Decide whether a trip's ETA still deserves to be presented as fact.
 *
 * This matters as much as the ETA itself. A number that stopped being updated
 * an hour ago is worse than no number, because it looks just as confident — so
 * the board is told to stop trusting it rather than left to guess.
 */
export function evaluateStaleness({ plan, state, now = new Date(), trafficAdjustments = null }) {
  const quiet = {
    isStale: false,
    minutesSinceLastConfirm: null,
    nextCheckpoint: null,
    nextCheckpointName: null,
    expectedAtNextCheckpoint: null,
    staleAfter: null,
  };

  if (!plan || !plan.length || !state) return quiet;
  if (state.status !== 'in_transit' && state.status !== 'delayed') return quiet;

  const anchor = state.lastConfirmedAt ?? state.actualDeparture;
  if (!anchor) return quiet;

  const nextIndex = state.lastConfirmedIndex + 1;
  if (nextIndex >= plan.length) return quiet;

  const segmentBaseline = plan[nextIndex].baselineMinutesFromPrevious || 0;

  // If traffic says this stretch is crawling, a bus that has not reported yet
  // is late, not missing. Extending the window by the reported delay stops the
  // board crying "no recent update" at a bus that is simply stuck in the jam we
  // already know about.
  const trafficMinutes = trafficAdjustments
    ? trafficAdjustments[
        `${idOf(plan[nextIndex - 1].checkpoint)}->${idOf(plan[nextIndex].checkpoint)}`
      ] || 0
    : 0;

  const expectedAtNextCheckpoint = addMinutes(anchor, segmentBaseline + Math.max(0, trafficMinutes));
  const staleAfter = addMinutes(expectedAtNextCheckpoint, segmentBaseline * STALE_GRACE_RATIO);

  return {
    isStale: toDate(now).getTime() > staleAfter.getTime(),
    minutesSinceLastConfirm: Math.max(0, Math.round(minutesBetween(anchor, now))),
    nextCheckpoint: plan[nextIndex].checkpoint,
    nextCheckpointName: plan[nextIndex].name,
    nextSegmentTrafficMinutes: trafficMinutes,
    expectedAtNextCheckpoint,
    staleAfter,
  };
}
