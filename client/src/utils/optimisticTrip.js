/**
 * Apply a conductor's tap to the trip on screen, immediately.
 *
 * The tap is already durable the moment it is made — it goes to localStorage
 * before anything else — but the *screen* was waiting on a round trip before it
 * moved: insert the log, replay the whole trip, save, re-read, populate. That is
 * about a second on a laptop against a local server and several on a phone on
 * mobile data, and for all of it the button still said the stop the bus had just
 * left. A conductor cannot tell a slow network from a tap that did not register,
 * so the honest-looking screen was the one that felt broken.
 *
 * So the obvious consequences of the tap are applied here at once: the stop goes
 * green, the bus advances, the button becomes the next checkpoint. The server's
 * reply then replaces this wholesale a moment later.
 *
 * What this deliberately does NOT do is recompute arrival times. That is the ETA
 * engine's job, it lives on the server, and guessing at it here would put two
 * different answers on screen a second apart. The existing times simply stand,
 * flagged provisional, until the real ones arrive.
 */

const clone = (trip) => ({ ...trip, stops: trip.stops.map((s) => ({ ...s })) });

const ref = (stop) => (stop ? { checkpointId: stop.checkpointId, name: stop.name } : null);

const lastPassedIndex = (stops) =>
  stops.reduce((acc, s, i) => (s.progress === 'passed' ? i : acc), -1);

/**
 * @param trip       the trip currently on screen
 * @param entry      the tap: { type, checkpoint, load, delayReason }
 * @param reportedAt ISO string stamped when the conductor tapped
 */
export function applyTap(trip, entry, reportedAt) {
  if (!trip?.stops?.length) return trip;

  const next = clone(trip);
  const stops = next.stops;
  const lastIndex = stops.length - 1;

  // Load can ride along with any tap, so it is handled before the type switch.
  if (entry.load) {
    next.load = entry.load;
    next.loadReportedAt = reportedAt;
    next.loadReportedAtName = next.lastConfirmedCheckpoint?.name ?? null;
  }

  const advanceTo = (index) => {
    // A conductor who skips a checkpoint and taps a later one should not leave
    // the passed-over stops looking like they are still ahead.
    for (let i = lastPassedIndex(stops) + 1; i < index; i += 1) {
      if (stops[i].progress === 'pending') stops[i].progress = 'skipped';
    }
    stops[index].progress = 'passed';
    stops[index].actualArrival = reportedAt;

    next.lastConfirmedCheckpoint = ref(stops[index]);
    next.lastConfirmedAt = reportedAt;
    next.nextCheckpoint = ref(stops[index + 1]);
    next.leftLastCheckpointAt = null;
    // Reaching a stop is where the load changes, so what was reported for the
    // last leg is now unknown rather than merely old.
    next.load = entry.load ?? null;
    next.loadReportedAt = entry.load ? reportedAt : null;
    next.loadReportedAtName = entry.load ? stops[index].name : null;
    // Nobody boards at a timing point, so a landmark is never "at".
    next.position = stops[index].type === 'landmark' ? 'between' : 'at_stop';
    next.positionInferred = false;
  };

  switch (entry.type) {
    case 'departed': {
      next.actualDeparture = reportedAt;
      next.status = 'in_transit';
      stops[0].progress = 'passed';
      stops[0].actualArrival = reportedAt;
      next.lastConfirmedCheckpoint = ref(stops[0]);
      next.lastConfirmedAt = reportedAt;
      next.nextCheckpoint = ref(stops[1]);
      // Departing is the pull-out from the origin, not a dwell at it.
      next.leftLastCheckpointAt = reportedAt;
      next.position = 'between';
      next.positionInferred = false;
      break;
    }

    case 'passed_checkpoint': {
      const index = stops.findIndex((s) => s.checkpointId === String(entry.checkpoint));
      if (index <= 0) break;
      advanceTo(index);
      if (index === lastIndex) {
        next.status = 'arrived';
        next.actualArrival = reportedAt;
        next.position = 'arrived';
      }
      break;
    }

    case 'left_checkpoint': {
      next.leftLastCheckpointAt = reportedAt;
      next.position = 'between';
      next.positionInferred = false;
      break;
    }

    case 'arrived': {
      advanceTo(lastIndex);
      next.status = 'arrived';
      next.actualArrival = reportedAt;
      next.position = 'arrived';
      break;
    }

    case 'delayed': {
      // Context only. A delay report is not anchored to a measured distance and
      // must not move anything.
      next.latestDelay = {
        reason: entry.delayReason ?? 'other',
        reportedAt,
        nearCheckpoint: next.lastConfirmedCheckpoint?.name ?? null,
      };
      break;
    }

    case 'load_report':
      break;

    default:
      return trip;
  }

  // Times on screen are the ones computed before this tap. Say so, so nothing
  // claims to be a fresh projection until the server sends one.
  next.isProvisional = true;
  return next;
}
