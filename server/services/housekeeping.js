import { Trip } from '../models/index.js';
import { cumulativeBaseline } from './etaEngine.js';

/**
 * Closing the trips nobody ever closed.
 *
 * A conductor's last tap is the one most easily forgotten: the bus has arrived,
 * everyone is getting off, and the phone stays in a pocket. The trip then sits
 * "in transit" for ever — on the operator's list, in the conductor's own roster,
 * and in every query that looks for running buses.
 *
 * This gives up on those, and is careful about what giving up means. Nothing is
 * asserted about where the bus went: no arrival is invented, no cancellation is
 * recorded, because neither was observed. The trip is simply marked as no longer
 * reporting, stops being advertised, and is shown to the operator as closed. A
 * tap that arrives afterwards clears the mark (see tripService#recomputeTrip) —
 * an observation beats a guess, even a late one.
 */

/**
 * How long past its own expected arrival a silent trip is left alone.
 *
 * Generous on purpose: a bus can be genuinely late, a phone can be out of
 * signal for hours on a mountain stretch, and a queued tap can arrive long
 * afterwards. Closing a trip that is merely quiet would be worse than leaving
 * it open, because the operator would stop looking for it.
 */
export const SILENT_FOR_HOURS = 6;

const HOUR_MS = 60 * 60 * 1000;

/** The instant a trip should have finished, from its own frozen plan. */
export const expectedArrival = (trip) =>
  new Date(
    new Date(trip.scheduledDeparture).getTime() +
      cumulativeBaseline(trip.plan ?? [], (trip.plan?.length ?? 1) - 1) * 60000
  );

/** Whether a trip has been silent long enough to close. Pure. */
export function isAbandoned(trip, now = new Date()) {
  if (trip.abandonedAt) return false;
  if (!['in_transit', 'delayed'].includes(trip.status)) return false;

  const lastHeard = trip.lastConfirmedAt ?? trip.actualDeparture ?? trip.scheduledDeparture;
  const quietFor = now.getTime() - new Date(lastHeard).getTime();
  const overdueBy = now.getTime() - expectedArrival(trip).getTime();

  // Both must hold: long past when it should have finished, and nothing heard
  // for hours. A long final leg is covered by the first, a bus that stopped
  // reporting early in the run by the second.
  return overdueBy > SILENT_FOR_HOURS * HOUR_MS && quietFor > SILENT_FOR_HOURS * HOUR_MS;
}

/** Mark every trip that has gone quiet for good. Returns how many. */
export async function closeAbandonedTrips(now = new Date()) {
  const candidates = await Trip.find({
    status: { $in: ['in_transit', 'delayed'] },
    abandonedAt: null,
    // Cheap pre-filter; isAbandoned makes the real decision per trip.
    scheduledDeparture: { $lt: new Date(now.getTime() - SILENT_FOR_HOURS * HOUR_MS) },
  })
    .select('plan status scheduledDeparture actualDeparture lastConfirmedAt abandonedAt')
    .lean();

  const stale = candidates.filter((trip) => isAbandoned(trip, now));
  if (!stale.length) return 0;

  await Trip.updateMany(
    { _id: { $in: stale.map((t) => t._id) } },
    { $set: { abandonedAt: now } }
  );
  return stale.length;
}

/* ------------------------------------------------------------ background -- */

const INTERVAL_MS = 60 * 60 * 1000;
let timer = null;

async function sweep() {
  try {
    const closed = await closeAbandonedTrips();
    if (closed) console.log(`[housekeeping] closed ${closed} trip${closed === 1 ? '' : 's'} that stopped reporting`);
  } catch (err) {
    console.warn('[housekeeping] sweep failed:', err.message);
  }
}

export function startHousekeeping(intervalMs = INTERVAL_MS) {
  sweep();
  timer = setInterval(sweep, intervalMs);
  timer.unref?.();
  return timer;
}

export function stopHousekeeping() {
  if (timer) clearInterval(timer);
  timer = null;
}
