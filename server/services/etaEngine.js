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

/**
 * A trip counts as "delayed" once it is running more than this far behind —
 * behind *what the road allowed*, not behind the timetable.
 *
 * Those are different numbers and conflating them broke the status. A baseline
 * is one figure standing in for a leg that genuinely takes 32 minutes at
 * midnight and 39 at six in the evening, so a bus doing nothing wrong in
 * rush-hour traffic accrues variance against it and gets flagged — every day,
 * on every trip, until the badge means nothing. What a passenger needs the
 * flag to say is "something has gone wrong with this bus", not "it is 6 PM".
 *
 * So the delay decision runs on schedule variance minus whatever the road cost
 * (see `trafficAllowanceMinutes` on CheckpointLog). The ETA is untouched by
 * this: a bus 12 minutes behind arrives 12 minutes late whoever is to blame.
 */
export const DELAY_THRESHOLD_MINUTES = 5;

/**
 * Grace before an unconfirmed trip is called stale, as a fraction of the
 * segment's own baseline. A 20-minute hop goes stale 10 minutes past its
 * expected time; an 80-minute hop gets 40. Long rural segments should not trip
 * the flag as eagerly as short urban ones.
 */
export const STALE_GRACE_RATIO = 0.5;

/**
 * How long a bus can plausibly be standing at a stop before "still boarding"
 * stops being credible.
 *
 * Reporting the pull-out is optional — a conductor busy with fares should not
 * owe the system a second tap — so its absence cannot be read as proof the bus
 * is still there. Past this, the honest answer reverts to "on the road", marked
 * as inferred rather than confirmed.
 */
export const STOP_DWELL_GRACE_MINUTES = 10;

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
 * Rush hour, when a leg can carry its own baseline.
 *
 * One number cannot describe a road that takes 32 minutes at midnight and 39
 * at six in the evening: judged against the off-peak figure, every rush-hour
 * trip reads late every day. So a leg may also say what it takes in each peak,
 * and a trip uses whichever band the bus is scheduled to be driving it in.
 *
 * The windows are the MMDA's number-coding hours, the one definition of Metro
 * Manila rush hour that operators and passengers already live by. Manila time,
 * which has no daylight saving, so they never shift.
 */
export const TIME_BANDS = [
  { key: 'amPeak', label: 'Morning peak', fromMinute: 7 * 60, toMinute: 10 * 60 },
  { key: 'pmPeak', label: 'Evening peak', fromMinute: 17 * 60, toMinute: 20 * 60 },
];
export const OFF_PEAK = 'offPeak';

const MANILA_OFFSET_MINUTES = 8 * 60;

/** Which band a moment falls in, on the Manila clock. */
export function bandAt(instant) {
  const utcMinutes = Math.floor(toDate(instant).getTime() / MS_PER_MINUTE);
  const minuteOfDay = (((utcMinutes + MANILA_OFFSET_MINUTES) % 1440) + 1440) % 1440;
  const band = TIME_BANDS.find((b) => minuteOfDay >= b.fromMinute && minuteOfDay < b.toMinute);
  return band ? band.key : OFF_PEAK;
}

const bandValue = (value) => (Number.isFinite(value) && value >= 0 ? value : null);

/**
 * Choose each leg's baseline for a given departure. Pure; returns a new plan.
 *
 * Chosen leg by leg, not once for the whole trip: a five-hour run that leaves
 * at 14:00 drives its first legs off-peak and its last ones straight into the
 * evening rush. Each leg is judged by when the timetable has the bus *starting*
 * it — the departure plus the legs before it, as chosen.
 *
 * A leg with no figure for a band falls back to its off-peak baseline, so a
 * route that only ever had one number per leg behaves exactly as before.
 */
export function selectBaselines(plan, departure) {
  let elapsed = 0;
  return plan.map((entry, index) => {
    const offPeak = entry.offPeakMinutes ?? entry.baselineMinutesFromPrevious ?? 0;
    if (index === 0) {
      return { ...entry, baselineMinutesFromPrevious: 0, baselineBand: OFF_PEAK };
    }

    const band = departure ? bandAt(addMinutes(departure, elapsed)) : OFF_PEAK;
    const banded = band === OFF_PEAK ? null : bandValue(entry[`${band}Minutes`]);
    const minutes = banded ?? offPeak;
    elapsed += minutes;

    return {
      ...entry,
      baselineMinutesFromPrevious: minutes,
      // Which figure was used, so a trip can explain its own yardstick.
      baselineBand: banded === null ? OFF_PEAK : band,
    };
  });
}

/**
 * Freeze a route's ordered checkpoints onto a trip. Call this once, when the
 * trip is created — never again. `route.checkpoints` must be populated.
 *
 * Every band's figure is frozen with it, not just the one chosen, so a trip
 * moved to another time before it leaves can re-choose without reading the
 * route again — which may have been edited since.
 */
export function buildPlan(route, { departure = null } = {}) {
  if (!route || !route.checkpoints || !route.checkpoints.length) {
    throw new Error('Cannot build a trip plan from a route with no checkpoints.');
  }
  const plan = route.checkpoints.map((entry, index) => {
    const cp = entry.checkpoint;
    if (!cp || !cp.name) {
      throw new Error('Route checkpoints must be populated before building a plan.');
    }
    // The origin is the reference point, so its inbound baseline is always 0.
    const offPeak = index === 0 ? 0 : entry.baselineMinutesFromPrevious;
    return {
      checkpoint: idOf(cp),
      name: cp.name,
      type: cp.type,
      baselineMinutesFromPrevious: offPeak,
      offPeakMinutes: offPeak,
      amPeakMinutes: index === 0 ? null : bandValue(entry.amPeakMinutes),
      pmPeakMinutes: index === 0 ? null : bandValue(entry.pmPeakMinutes),
    };
  });
  return selectBaselines(plan, departure);
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
// passed anything, you leave a stop after reaching it, and you pass things
// before you arrive.
const TYPE_RANK = {
  // Boarding comes before departing: you cannot leave a terminal you never
  // reached, and at the same timestamp that is the order of events.
  boarding: -1,
  departed: 0,
  passed_checkpoint: 1,
  left_checkpoint: 2,
  arrived: 3,
  // After an arrival: if both land on the same second, the bus got there.
  terminated: 4,
  delayed: 5,
};

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
  /**
   * Sum of the road conditions recorded on the legs already driven.
   *
   * The one genuinely accumulated quantity here, and unavoidably so: each leg
   * was driven under its own conditions and there is no absolute measurement
   * that recovers them after the fact. It stays safe because the sum is rebuilt
   * from the logs on every replay rather than carried between calls, so trip
   * state is still a pure function of the event stream.
   */
  let conditionsAllowance = 0;
  let latestDelay = null;
  // Set when the bus cannot finish the run: a breakdown, an accident, a bus
  // pulled out of service. The trip ends where it stands.
  let terminated = null;
  /**
   * When the conductor confirmed the bus was at its starting point with the
   * doors open.
   *
   * Before this, nobody has said where the bus is. A scheduled trip used to be
   * drawn as a bus standing at its origin boarding passengers, which is an
   * assumption — the bus may still be finishing its previous run, or stuck in
   * the yard. The whole system exists to avoid asserting a position nobody
   * confirmed, and this was the one place it did.
   */
  let boardingSince = null;
  // When the bus pulled out of the checkpoint it most recently reached. Null
  // while it is still standing there.
  let leftLastCheckpointAt = null;
  // How full the bus is, and where the conductor said so. Cleared whenever the
  // bus reaches a new stop, because that is exactly where it can change.
  let load = null;
  let loadReportedAt = null;
  let loadReportedAtIndex = -1;
  const ignored = [];

  const skip = (log, reason) =>
    ignored.push({ clientLogId: log.clientLogId ?? null, type: log.type, reason });

  // Variance measured from departure, not from the previous segment.
  const varianceAt = (index, reportedAt) =>
    minutesBetween(actualDeparture, reportedAt) - cumulativeBaseline(plan, index);

  const advanceTo = (index, reportedAt, allowanceMinutes = null) => {
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
    // Reaching a new point means the bus is no longer standing at the old one.
    leftLastCheckpointAt = null;
    /**
     * A stop is the one place where the load can change — people board and
     * alight — so whatever was reported for the last leg is now unknown rather
     * than merely old. Carrying it forward would let "full" survive past the
     * stop where the bus emptied, and someone downstream would give up on a bus
     * they could have caught.
     */
    load = null;
    loadReportedAt = null;
    loadReportedAtIndex = -1;
    exactVariance = varianceAt(index, reportedAt);
    // A leg with no reading is not a leg that was clear — it is one we cannot
    // speak for, so it excuses nothing.
    if (typeof allowanceMinutes === 'number' && Number.isFinite(allowanceMinutes)) {
      conditionsAllowance += allowanceMinutes;
    }
  };

  for (const log of sortLogs(logs)) {
    // Load rides along with whatever the conductor was already tapping, so the
    // common case costs no extra action.
    if (log.load) {
      load = log.load;
      loadReportedAt = toDate(log.reportedAt);
      loadReportedAtIndex = lastConfirmedIndex;
    }

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
        conditionsAllowance = 0;
        /**
         * Departing *is* the pull-out from the origin — that is what the word
         * means and what the conductor taps it to say.
         *
         * Leaving it unset made the origin's own board announce a bus that had
         * gone as still boarding, and then, once the dwell grace expired, call
         * its departure *inferred* — hedging over the one movement the
         * conductor had explicitly confirmed.
         */
        leftLastCheckpointAt = actualDeparture;
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
        advanceTo(index, log.reportedAt, log.trafficAllowanceMinutes);
        // Passing the final checkpoint is an arrival.
        if (index === lastIndex) actualArrival = toDate(log.reportedAt);
        break;
      }

      case 'left_checkpoint': {
        if (lastConfirmedIndex < 0) {
          skip(log, 'no_checkpoint_to_leave');
          break;
        }
        if (actualArrival) {
          skip(log, 'after_arrival');
          break;
        }
        // Only the point the bus is currently standing at can be left.
        const index = planIndexOf(plan, log.checkpoint);
        if (index !== -1 && index !== lastConfirmedIndex) {
          skip(log, 'not_the_current_checkpoint');
          break;
        }

        leftLastCheckpointAt = toDate(log.reportedAt);

        /**
         * Dwell that has already happened is elapsed time like any other, and
         * a leg's baseline includes the dwell at the stop it ends on — so the
         * same variance formula measures "how late it is *leaving*" without
         * any special case. A bus that arrives on time and then sits for
         * twenty minutes is twenty minutes late from here on, and the board
         * says so immediately instead of waiting for the next checkpoint.
         */
        exactVariance = varianceAt(lastConfirmedIndex, log.reportedAt);
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
        advanceTo(lastIndex, log.reportedAt, log.trafficAllowanceMinutes);
        actualArrival = toDate(log.reportedAt);
        break;
      }

      /**
       * The run is over without reaching the end.
       *
       * Distinct from a delay, which says "later", and from an arrival, which
       * says "here". This says "not at all", and it is the one thing a
       * passenger waiting further down the route most needs to be told: every
       * projection ahead of it is withdrawn rather than quietly kept ticking.
       *
       * Allowed before departure too — a bus that will not start at the
       * terminal is exactly this, reported from the bay.
       */
      case 'terminated': {
        if (actualArrival) {
          skip(log, 'after_arrival');
          break;
        }
        if (terminated) {
          skip(log, 'already_terminated');
          break;
        }
        terminated = {
          reason: log.delayReason ?? 'other',
          reportedAt: toDate(log.reportedAt),
          nearCheckpoint: lastConfirmedIndex >= 0 ? plan[lastConfirmedIndex].name : null,
        };
        break;
      }

      /**
       * At the starting point, doors open. The one thing a passenger heading
       * for a terminal wants to know before a departure: is it actually there?
       */
      case 'boarding': {
        if (actualDeparture) {
          skip(log, 'after_departure');
          break;
        }
        if (boardingSince) {
          skip(log, 'already_boarding');
          break;
        }
        boardingSince = toDate(log.reportedAt);
        break;
      }

      case 'load_report':
        // Nothing further to do — the load was picked up above, and this
        // carries no position information at all.
        break;

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
      } else if (terminated) {
        // The bus is not coming. A time here would be read as a promise.
        projectedArrival = null;
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

  /**
   * How far behind the bus is once the road is accounted for.
   *
   * Expanded, this is elapsed time minus what each leg actually took today,
   * which is the only fair question to ask of a driver. It collapses to plain
   * schedule variance whenever no conditions were recorded, so a deployment
   * with no traffic provider behaves exactly as it did before.
   *
   * The sign is kept symmetric on purpose. A quiet road that ran ten minutes
   * under baseline hands back a negative allowance, and a bus that still lost
   * time on it is judged against the road it actually had, not the average one.
   */
  const faultVariance = exactVariance - conditionsAllowance;

  let status;
  if (cancelled || terminated) status = 'cancelled';
  else if (actualArrival) status = 'arrived';
  else if (!actualDeparture) status = 'scheduled';
  else status = faultVariance > DELAY_THRESHOLD_MINUTES ? 'delayed' : 'in_transit';

  /**
   * Where the bus is, in the only two forms this system can honestly report.
   *
   *   at_stop  — reached a station and has not reported leaving it, so it is
   *              standing there and may still be boarding
   *   between  — on the road between the last confirmed point and the next
   *
   * A landmark is never "at": it is a timing point a bus drives past, so the
   * conductor logs one event and the bus is immediately between.
   */
  const lastEntry = lastConfirmedIndex >= 0 ? plan[lastConfirmedIndex] : null;
  const standingAtStop =
    !!lastEntry &&
    lastEntry.type !== 'landmark' &&
    !leftLastCheckpointAt &&
    !actualArrival &&
    !!actualDeparture &&
    // The origin before departure is handled by the scheduled state, and the
    // final stop is an arrival, not a dwell.
    lastConfirmedIndex < lastIndex;

  return {
    status,
    actualDeparture,
    actualArrival,
    lastConfirmedIndex,
    lastConfirmedCheckpoint:
      lastConfirmedIndex >= 0 ? plan[lastConfirmedIndex].checkpoint : null,
    lastConfirmedAt,
    position: actualArrival ? 'arrived' : standingAtStop ? 'at_stop' : 'between',
    leftLastCheckpointAt,
    load,
    loadReportedAt,
    // Which checkpoint the bus had last reached when the load was reported, so
    // the board can say "as it left Calamba" rather than implying it is current.
    loadReportedAtCheckpoint:
      loadReportedAtIndex >= 0 ? plan[loadReportedAtIndex].checkpoint : null,
    loadReportedAtName: loadReportedAtIndex >= 0 ? plan[loadReportedAtIndex].name : null,
    // Rounded for storage and display; the projections above use the exact
    // value so the clock stays honest.
    cumulativeVarianceMinutes: Math.round(exactVariance),
    exactVarianceMinutes: exactVariance,
    // What the road cost on the legs already driven, and what is left over
    // after subtracting it. Surfaced together so a board can say *why* a bus is
    // behind instead of showing a bare red badge nobody can act on.
    conditionsAllowanceMinutes: Math.round(conditionsAllowance),
    faultVarianceMinutes: Math.round(faultVariance),
    computedETAs,
    finalVarianceMinutes: actualArrival ? Math.round(exactVariance) : null,
    latestDelay,
    // Null until a conductor says the bus is at its starting point. Until
    // then nothing is claimed about where it is.
    boardingSince,
    // Null unless the run was ended early, in which case: why, when, and the
    // last point it had reached.
    terminated,
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
/**
 * Turn the recorded position into what can honestly be shown right now.
 *
 * `computeTripState` works purely from logs and so reports `at_stop` until a
 * pull-out is logged. Only the clock can say whether that is still believable.
 */
export function resolvePosition({ state, now = new Date(), graceMinutes = STOP_DWELL_GRACE_MINUTES }) {
  if (state.position !== 'at_stop' || !state.lastConfirmedAt) {
    return { position: state.position, inferred: false, minutesStanding: null };
  }

  const minutesStanding = Math.max(0, Math.round(minutesBetween(state.lastConfirmedAt, now)));
  if (minutesStanding <= graceMinutes) {
    return { position: 'at_stop', inferred: false, minutesStanding };
  }

  // Nobody said it left, but no bus boards for this long. Say it has probably
  // gone, and be clear that is a guess rather than a confirmation.
  return { position: 'between', inferred: true, minutesStanding };
}

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

  // Leaving a stop is newer information than reaching it, so the silence is
  // measured from whichever the bus reported last.
  const anchor = state.leftLastCheckpointAt ?? state.lastConfirmedAt ?? state.actualDeparture;
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
