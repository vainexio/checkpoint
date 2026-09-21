import { Checkpoint, Trip } from '../models/index.js';
import { getTrafficProvider, refreshSegment } from './trafficProvider.js';
import { trafficKeyStatus } from './trafficKeys.js';
import { liveWindow } from './tripWindow.js';

/**
 * Keeps the traffic cache warm for the road buses are about to drive — and
 * nothing else.
 *
 * This is where "checkpoints make traffic cheap" pays off. A GPS system has no
 * idea which stretch of highway matters, so it polls everything. We know each
 * bus's last confirmed checkpoint, so we know exactly which segment is worth
 * asking about, and we ask once per segment no matter how many buses are on it.
 *
 * And only for what someone is looking at. The refresher first ran on the
 * clock, and demo trips that nobody finishes kept fifteen segments "in
 * transit" for good: every segment, every five minutes, around the clock —
 * about 4,300 requests a day per server, which emptied the provider's free
 * monthly allowance in days. It then learned to stop when nobody was using
 * the site at all. Now it goes further: a request is spent only on the next
 * leg of a bus that is on a board or trip page someone has open, every ten
 * minutes. A passenger watching one station costs a request or two per cycle,
 * not the whole network.
 */

const DEFAULT_INTERVAL_MS = 10 * 60 * 1000;

/**
 * How long after a page was last loaded it still counts as being looked at.
 *
 * Every screen that shows traffic polls well inside this, so an open tab — a
 * passenger on a board, a terminal display on a wall — keeps its buses'
 * traffic fresh for exactly as long as it stays open.
 */
export const DEMAND_WINDOW_MS = 10 * 60 * 1000;

// The leg each bus is on now. Traffic further ahead changes before the bus
// gets there, so paying for it early buys a number that will be replaced.
const LOOKAHEAD_SEGMENTS = 1;

let timer = null;
/** 'station:<id>' | 'trip:<id>' -> last time a page for it was loaded */
const demand = new Map();
let pausedUntil = 0;
let pauseReason = null;
let inFlight = null;
// What the previous skipped cycle was waiting on, so the logs record a change
// of state once rather than repeating it every cycle.
let lastSkip = null;

const OBJECT_ID = '[a-f0-9]{24}';
const DEMAND_PATHS = [
  // A station board, including the terminal display, which reads the same.
  [new RegExp(`^/public/stations/(${OBJECT_ID})/board$`), 'station'],
  // One trip: the passenger trip page, the conductor's own screen (so a tap
  // closing a leg has the road reading to record), and the admin record.
  [new RegExp(`^/public/trips/(${OBJECT_ID})$`), 'trip'],
  [new RegExp(`^/conductor/trips/(${OBJECT_ID})$`), 'trip'],
  [new RegExp(`^/admin/trips/(${OBJECT_ID})$`), 'trip'],
];

/**
 * Which buses a request is asking to see, from its path under /api. Pages
 * that show no live traffic — the stop list, the map, admin lists — return
 * null and cost nothing.
 */
export function demandFromPath(path) {
  for (const [pattern, kind] of DEMAND_PATHS) {
    const match = pattern.exec(path);
    if (match) return { [`${kind}Id`]: match[1] };
  }
  return null;
}

/** What is being looked at right now, forgetting anything past the window. */
export function demandedTargets(now = Date.now()) {
  const stationIds = [];
  const tripIds = [];
  for (const [key, at] of demand) {
    if (now - at > DEMAND_WINDOW_MS) {
      demand.delete(key);
      continue;
    }
    const [kind, id] = key.split(':');
    (kind === 'station' ? stationIds : tripIds).push(id);
  }
  return { stationIds, tripIds };
}

const hasTargets = ({ stationIds, tripIds }) => stationIds.length + tripIds.length > 0;

/**
 * The segments worth asking about, given which trips and stations are being
 * looked at. Pure, so the selection is tested without a database.
 *
 * A trip being looked at directly contributes the leg it is on. A station
 * contributes the leg of every bus still coming to it — a bus that has already
 * been and gone does not affect anyone waiting there.
 */
export function segmentsFor(trips, { stationIds = [], tripIds = [] } = {}) {
  const stations = new Set(stationIds.map(String));
  const watchedTrips = new Set(tripIds.map(String));
  const wanted = new Map();

  for (const trip of trips) {
    const plan = trip.plan ?? [];
    const lastIndex = trip.lastConfirmedCheckpoint
      ? plan.findIndex((p) => String(p.checkpoint) === String(trip.lastConfirmedCheckpoint))
      : 0;

    const comingToAWatchedStop = plan.some(
      (p, i) => i > lastIndex && stations.has(String(p.checkpoint))
    );
    if (!watchedTrips.has(String(trip._id)) && !comingToAWatchedStop) continue;

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

/** The segments to refresh for what is being looked at, de-duplicated. */
export async function pendingSegments(targets) {
  if (!hasTargets(targets)) return [];
  // Through the same window as the boards: a trip abandoned days ago is still
  // "in transit" in the database, and is on nobody's screen.
  const { $or: running, ...window } = liveWindow();
  const trips = await Trip.find({
    status: { $in: ['in_transit', 'delayed'] },
    ...window,
    $and: [
      { $or: running },
      { $or: [{ _id: { $in: targets.tripIds } }, { 'plan.checkpoint': { $in: targets.stationIds } }] },
    ],
  })
    .select('plan lastConfirmedCheckpoint')
    .lean();
  return segmentsFor(trips, targets);
}

export async function refreshOnce(targets = demandedTargets()) {
  const provider = getTrafficProvider();
  if (!provider.enabled) return { provider: provider.name, refreshed: 0, skipped: 'disabled' };

  const segments = await pendingSegments(targets);
  if (!segments.length) return { provider: provider.name, refreshed: 0, considered: 0 };

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
 * Someone opened a page that shows live traffic.
 *
 * Something newly looked at is refreshed straight away, so the person who
 * opened it sees traffic on their next poll rather than up to ten minutes
 * later. That costs only its own segments: anything already asked about
 * recently is answered from the cache.
 */
export function noteTrafficDemand(target, now = Date.now()) {
  if (!target) return;
  const key = target.stationId ? `station:${target.stationId}` : `trip:${target.tripId}`;
  const isNew = !demand.has(key) || now - demand.get(key) > DEMAND_WINDOW_MS;
  demand.set(key, now);
  if (isNew && timer) runCycle({ now });
}

/** Whether a cycle should spend requests right now, and if not, why not. */
export function refreshGate(now = Date.now()) {
  if (now < pausedUntil) return { run: false, reason: 'paused' };
  if (!hasTargets(demandedTargets(now))) return { run: false, reason: 'idle' };
  return { run: true, reason: null };
}

/**
 * What the refresher is doing, for /health.
 *
 * "Why is there no traffic on the board" should be answerable without reading
 * server logs. Keys are listed by their variable name and state; nothing here
 * carries a key's value.
 */
export function getTrafficStatus(now = Date.now()) {
  const provider = getTrafficProvider();
  if (!provider.enabled) return { provider: provider.name, state: 'disabled' };

  const keys = trafficKeyStatus(now);
  const gate = refreshGate(now);
  const { stationIds, tripIds } = demandedTargets(now);
  const base = {
    provider: provider.name,
    watching: { stations: stationIds.length, trips: tripIds.length },
    keys,
  };

  if (gate.reason === 'paused') {
    return { ...base, state: 'paused', reason: pauseReason, resumesAt: new Date(pausedUntil) };
  }
  return { ...base, state: gate.run ? 'active' : gate.reason };
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
      console.log('[traffic] no board with live buses is open — lookups paused until one is');
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
      const result = await refresh(demandedTargets(now));
      if (result?.refreshed) {
        console.log(`[traffic] refreshed ${result.refreshed}/${result.considered} segments`);
      }
      return result;
    } catch (err) {
      // Only reaches here once every key has been refused or is resting —
      // trafficKeys.js steps past a single refused key on its own.
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
  // worth paying for. The first board opened starts the first cycle.
  timer = setInterval(() => runCycle(), intervalMs);
  // Never hold the process open for a cache warmer.
  timer.unref?.();

  const keys = trafficKeyStatus().length;
  console.log(
    `[traffic] ${provider.name} provider active with ${keys} key${keys === 1 ? '' : 's'} — ` +
      `refreshing every ${intervalMs / 60000}m for buses on boards being viewed`
  );
  return timer;
}

/** Test seam: forget demand, pauses and any cycle in flight. */
export function resetTrafficRefresherState() {
  demand.clear();
  pausedUntil = 0;
  pauseReason = null;
  inFlight = null;
  lastSkip = null;
}

export function stopTrafficRefresher() {
  if (timer) clearInterval(timer);
  timer = null;
}
