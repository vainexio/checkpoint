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
 *
 * And only while someone is looking. Knowing *which* road matters was not
 * enough on its own: the refresher used to run on the clock, and demo trips
 * that nobody ever finishes kept the same fifteen segments "in transit" for
 * good. That was every segment, every five minutes, around the clock, on a
 * server nobody had open — about 4,300 requests a day per process, which is
 * how the provider account ran out of credits. Traffic is only worth paying
 * for while it can be seen, so a request for any page is what keeps it on.
 */

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;

/**
 * How long after the last request the refresher keeps asking.
 *
 * Every screen that shows traffic polls well inside this, so an open tab — a
 * passenger on a board, a terminal display on a wall — keeps lookups going for
 * exactly as long as it stays open, and a server nobody is using goes quiet
 * within ten minutes of the last visit.
 */
export const DEMAND_WINDOW_MS = 10 * 60 * 1000;

// How far ahead of each bus to look. Two segments is enough to inform the ETA a
// passenger is reading without pre-fetching a whole route nobody has reached.
const LOOKAHEAD_SEGMENTS = 2;

let timer = null;
let lastDemandAt = 0;
let pausedUntil = 0;
let pauseReason = null;
let inFlight = null;
// What the previous skipped cycle was waiting on, so the logs record a change
// of state once rather than repeating it every five minutes.
let lastSkip = null;

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

/**
 * Someone is using the system. Called for every API read.
 *
 * After a quiet spell this also refreshes straight away, so the first person to
 * open a board sees traffic on their next poll rather than waiting up to a full
 * interval for the timer to come round.
 */
export function noteTrafficDemand(now = Date.now()) {
  const wasIdle = now - lastDemandAt > DEMAND_WINDOW_MS;
  lastDemandAt = now;
  if (wasIdle && timer) runCycle({ now });
}

/** Whether a cycle should spend requests right now, and if not, why not. */
export function refreshGate(now = Date.now()) {
  if (now < pausedUntil) return { run: false, reason: 'paused' };
  if (now - lastDemandAt > DEMAND_WINDOW_MS) return { run: false, reason: 'idle' };
  return { run: true, reason: null };
}

/**
 * What the refresher is doing, for /health.
 *
 * "Why is there no traffic on the board" should be answerable without reading
 * server logs. The pause reason is TomTom's own error code, never the request,
 * so nothing here carries the key.
 */
export function getTrafficStatus(now = Date.now()) {
  const provider = getTrafficProvider();
  if (!provider.enabled) return { provider: provider.name, state: 'disabled' };

  const gate = refreshGate(now);
  if (gate.reason === 'paused') {
    return {
      provider: provider.name,
      state: 'paused',
      reason: pauseReason,
      resumesAt: new Date(pausedUntil),
    };
  }
  return { provider: provider.name, state: gate.run ? 'active' : gate.reason };
}

/**
 * One refresh cycle, if the gate allows it.
 *
 * `refresh` is injectable so the gating and pausing can be tested without a
 * database or a network.
 */
export async function runCycle({ now = Date.now(), refresh = refreshOnce } = {}) {
  const gate = refreshGate(now);

  if (!gate.run) {
    if (gate.reason !== lastSkip && gate.reason === 'idle') {
      console.log('[traffic] nobody has opened a board in 10m — lookups paused until someone does');
    }
    lastSkip = gate.reason;
    return { skipped: gate.reason };
  }

  if (lastSkip === 'idle') console.log('[traffic] a board is being viewed — lookups resumed');
  if (lastSkip === 'paused') console.log('[traffic] pause over — trying the provider again');
  lastSkip = null;

  // One cycle at a time. A cycle still running when the next tick or a burst
  // of first requests arrives is joined, not duplicated.
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const result = await refresh();
      if (result?.refreshed) {
        console.log(`[traffic] refreshed ${result.refreshed}/${result.considered} segments`);
      }
      return result;
    } catch (err) {
      if (err?.pauseMs > 0) {
        pausedUntil = now + err.pauseMs;
        pauseReason = err.code ?? `HTTP ${err.status}`;
        console.warn(
          `[traffic] ${err.message} — pausing lookups for ${Math.round(err.pauseMs / 60000)}m`
        );
        return { paused: pauseReason };
      }
      console.warn('[traffic] refresh cycle failed:', err.message);
      return { failed: err.message };
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

export function startTrafficRefresher(intervalMs = DEFAULT_INTERVAL_MS) {
  const provider = getTrafficProvider();
  if (!provider.enabled) {
    console.log('[traffic] no provider configured — ETAs use static baselines only.');
    return null;
  }

  // No run on boot: a freshly started server with nobody on it has nothing
  // worth paying for. The first request to arrive starts the first cycle.
  timer = setInterval(() => runCycle(), intervalMs);
  // Never hold the process open for a cache warmer.
  timer.unref?.();

  console.log(
    `[traffic] ${provider.name} provider active — refreshing every ${intervalMs / 60000}m ` +
      'while a board is being viewed'
  );
  return timer;
}

/** Test seam: forget demand, pauses and any cycle in flight. */
export function resetTrafficRefresherState() {
  lastDemandAt = 0;
  pausedUntil = 0;
  pauseReason = null;
  inFlight = null;
  lastSkip = null;
}

export function stopTrafficRefresher() {
  if (timer) clearInterval(timer);
  timer = null;
}
