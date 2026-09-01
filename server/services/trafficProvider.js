/**
 * Live traffic, asked about sparingly.
 *
 * The baseline in a route is what a segment *usually* takes. Traffic tells us
 * what it is taking right now. This module turns the second into a per-segment
 * adjustment in minutes that the ETA engine can apply to the road still ahead.
 *
 * Three rules keep it from being spammy, which matters because these APIs bill
 * per request:
 *
 *   1. Checkpoints already tell us where the bus is, so we never sweep a whole
 *      route. We ask only about segments a trip is actually about to drive.
 *   2. Answers are cached per segment, so twenty buses on the Cubao–Baguio run
 *      share one lookup rather than making twenty.
 *   3. Nothing here is on the request path. If the cache is cold or the
 *      provider is down, the ETA falls back to the pure baseline — a slightly
 *      staler number, never an error and never a blocked page.
 */

const CACHE_TTL_MS = 5 * 60 * 1000; // A segment's traffic does not change every second.
const REQUEST_TIMEOUT_MS = 6000;

/** segmentKey -> { adjustmentMinutes, liveMinutes, fetchedAt, source } */
const cache = new Map();

export const segmentKey = (fromId, toId) => `${fromId}->${toId}`;

const isFresh = (entry, now) => entry && now - entry.fetchedAt < CACHE_TTL_MS;

/**
 * The seam the build doc asked for: a provider takes segment endpoints and
 * returns how long the drive is taking right now. Swapping providers — or
 * going back to pure baselines — is this one function.
 */
export class StaticTrafficProvider {
  get name() {
    return 'static';
  }

  get enabled() {
    return false;
  }

  // No live data: every segment runs at its baseline, which is exactly the
  // behaviour of the system before traffic existed.
  async liveMinutesFor() {
    return null;
  }
}

/**
 * TomTom Routing API. Chosen because its free tier needs no card, and it
 * returns live-traffic travel time directly rather than a range.
 */
export class TomTomTrafficProvider {
  constructor(apiKey) {
    this.apiKey = apiKey;
  }

  get name() {
    return 'tomtom';
  }

  get enabled() {
    return Boolean(this.apiKey);
  }

  async liveMinutesFor(from, to) {
    const url =
      `https://api.tomtom.com/routing/1/calculateRoute/` +
      `${from.lat},${from.lng}:${to.lat},${to.lng}/json` +
      `?key=${encodeURIComponent(this.apiKey)}&traffic=true&travelMode=bus&routeType=fastest` +
      // Without this TomTom returns only the live figure and the breakdown
      // fields come back undefined.
      `&computeTravelTimeFor=all`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`TomTom responded ${res.status}`);

      const body = await res.json();
      const seconds = body?.routes?.[0]?.summary?.travelTimeInSeconds;
      if (typeof seconds !== 'number') throw new Error('TomTom returned no travel time');

      return seconds / 60;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Pick a provider from the environment. Absent key means static baselines. */
export function createTrafficProvider(env = process.env) {
  const key = env.TRAFFIC_API_KEY;
  const provider = (env.TRAFFIC_PROVIDER || (key ? 'tomtom' : 'static')).toLowerCase();

  if (provider === 'tomtom' && key) return new TomTomTrafficProvider(key);
  return new StaticTrafficProvider();
}

let activeProvider = null;
export const getTrafficProvider = () => {
  if (!activeProvider) activeProvider = createTrafficProvider();
  return activeProvider;
};

/** Test seam: swap the provider and clear anything it cached. */
export function setTrafficProvider(provider) {
  activeProvider = provider;
  cache.clear();
}

export const clearTrafficCache = () => cache.clear();

/**
 * Refresh one segment, if it is stale and we know where both ends are.
 *
 * `baselineMinutes` is what the operator says this leg usually takes; the
 * adjustment is how much longer traffic says it is taking right now. A negative
 * adjustment (quiet roads) is kept — being early is as true as being late.
 */
export async function refreshSegment({ from, to, baselineMinutes, now = Date.now() }) {
  const provider = getTrafficProvider();
  if (!provider.enabled) return null;

  if (!from?.location?.lat || !to?.location?.lat) return null;

  const key = segmentKey(String(from._id ?? from.id), String(to._id ?? to.id));
  const cached = cache.get(key);
  if (isFresh(cached, now)) return cached;

  try {
    const liveMinutes = await provider.liveMinutesFor(from.location, to.location);
    if (liveMinutes === null) return null;

    const entry = {
      liveMinutes,
      baselineMinutes,
      adjustmentMinutes: Math.round(liveMinutes - baselineMinutes),
      fetchedAt: now,
      source: provider.name,
    };
    cache.set(key, entry);
    return entry;
  } catch (err) {
    // A traffic lookup failing is not a trip failing. Keep whatever we had.
    console.warn(`[traffic] ${key} lookup failed: ${err.message}`);
    return cached ?? null;
  }
}

/** Everything currently known, as { segmentKey: adjustmentMinutes }. */
export function getAdjustments(now = Date.now()) {
  const out = {};
  for (const [key, entry] of cache) {
    if (isFresh(entry, now)) out[key] = entry.adjustmentMinutes;
  }
  return out;
}

export function getSegmentDetail(fromId, toId, now = Date.now()) {
  const entry = cache.get(segmentKey(String(fromId), String(toId)));
  return isFresh(entry, now) ? entry : null;
}
