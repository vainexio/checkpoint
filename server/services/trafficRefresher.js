import { Checkpoint, Trip } from '../models/index.js';
import { getTrafficProvider, refreshSegment } from './trafficProvider.js';

/**
 * Keeps the traffic cache warm for the road buses are about to drive — and
 * nothing else.
 *
 * This is where "checkpoints make traffic cheap" pays off. A GPS system has no
 * idea which stretch of highway matters, so it polls everything. We know each
 * bus's last confirmed checkpoint, so we know exactly which one or two segments
 * are worth asking about, and we ask once per segment no matter how many buses
 * are on it.
 */

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;

// How far ahead of each bus to look. Two segments is enough to inform the ETA a
// passenger is reading without pre-fetching a whole route nobody has reached.
const LOOKAHEAD_SEGMENTS = 2;

let timer = null;

/** The segments any in-flight trip is about to drive, de-duplicated. */
export async function pendingSegments() {
  const trips = await Trip.find({ status: { $in: ['in_transit', 'delayed'] } })
    .select('plan lastConfirmedCheckpoint')
    .lean();

  const wanted = new Map();

  for (const trip of trips) {
    const plan = trip.plan ?? [];
    const lastIndex = trip.lastConfirmedCheckpoint
      ? plan.findIndex((p) => String(p.checkpoint) === String(trip.lastConfirmedCheckpoint))
      : 0;

    for (let step = 1; step <= LOOKAHEAD_SEGMENTS; step += 1) {
      const to = lastIndex + step;
      if (to <= 0 || to >= plan.length) break;

      const key = `${plan[to - 1].checkpoint}->${plan[to].checkpoint}`;
      // Many buses, one lookup: the segment is the unit, not the trip.
      if (!wanted.has(key)) {
        wanted.set(key, {
          fromId: String(plan[to - 1].checkpoint),
          toId: String(plan[to].checkpoint),
          baselineMinutes: plan[to].baselineMinutesFromPrevious || 0,
        });
      }
    }
  }

  return [...wanted.values()];
}

export async function refreshOnce() {
  const provider = getTrafficProvider();
  if (!provider.enabled) return { provider: provider.name, refreshed: 0, skipped: 'disabled' };

  const segments = await pendingSegments();
  if (!segments.length) return { provider: provider.name, refreshed: 0 };

  const ids = [...new Set(segments.flatMap((s) => [s.fromId, s.toId]))];
  const checkpoints = await Checkpoint.find({ _id: { $in: ids } })
    .select('name location')
    .lean();
  const byId = new Map(checkpoints.map((c) => [String(c._id), c]));

  let refreshed = 0;
  for (const segment of segments) {
    const entry = await refreshSegment({
      from: byId.get(segment.fromId),
      to: byId.get(segment.toId),
      baselineMinutes: segment.baselineMinutes,
    });
    if (entry) refreshed += 1;
  }

  return { provider: provider.name, refreshed, considered: segments.length };
}

export function startTrafficRefresher(intervalMs = DEFAULT_INTERVAL_MS) {
  const provider = getTrafficProvider();
  if (!provider.enabled) {
    console.log('[traffic] no provider configured — ETAs use static baselines only.');
    return null;
  }

  const run = () =>
    refreshOnce()
      .then((r) => {
        if (r.refreshed) console.log(`[traffic] refreshed ${r.refreshed}/${r.considered} segments`);
      })
      .catch((err) => console.warn('[traffic] refresh cycle failed:', err.message));

  run();
  timer = setInterval(run, intervalMs);
  // Never hold the process open for a cache warmer.
  timer.unref?.();

  console.log(`[traffic] ${provider.name} provider active, refreshing every ${intervalMs / 60000}m`);
  return timer;
}

export function stopTrafficRefresher() {
  if (timer) clearInterval(timer);
  timer = null;
}
