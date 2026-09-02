/**
 * Measure how long each leg of a route normally takes, so an operator does not
 * have to guess it.
 *
 * Distinct from `trafficProvider`, which asks what a road is doing *right now*
 * for a bus already running. This asks what a leg *typically* costs, once, while
 * a route is being drawn — the yardstick every future trip is measured against.
 *
 * Typical, not free-flow: free-flow is an empty road, which a bus in Metro
 * Manila never gets, and measuring against it would leave every trip
 * permanently "late" and make the delayed status meaningless.
 *
 * The number is a starting point, never the last word. An operator who runs the
 * route knows things a routing engine does not — a terminal that always takes
 * ten minutes to get out of, a market day, a school zone — so the value comes
 * back editable and is only ever a suggestion.
 */

// A bus does not pass a stop at speed; it pulls in, boards, and pulls out.
const DWELL_MINUTES = { station: 4, landmark: 0 };

// Typical times barely move day to day, so a long cache costs nothing and
// keeps a route being edited repeatedly from re-billing the same legs.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 8000;

const cache = new Map();
const keyFor = (a, b) => `${a.lat},${a.lng}->${b.lat},${b.lng}`;

export const canMeasure = () => Boolean(process.env.TRAFFIC_API_KEY);

async function typicalMinutes(from, to) {
  const key = keyFor(from, to);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const url =
    `https://api.tomtom.com/routing/1/calculateRoute/` +
    `${from.lat},${from.lng}:${to.lat},${to.lng}/json` +
    `?key=${encodeURIComponent(process.env.TRAFFIC_API_KEY)}` +
    `&traffic=true&travelMode=bus&routeType=fastest&computeTravelTimeFor=all`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`TomTom responded ${res.status}`);

    const summary = (await res.json()).routes?.[0]?.summary;
    // Without computeTravelTimeFor=all this field is absent and the live time
    // silently stands in for it — which is how a rush-hour measurement once
    // ended up baked into a baseline.
    const seconds =
      summary?.historicTrafficTravelTimeInSeconds ?? summary?.travelTimeInSeconds;
    if (typeof seconds !== 'number') throw new Error('TomTom returned no travel time');

    const value = { minutes: seconds / 60, km: (summary.lengthInMeters ?? 0) / 1000 };
    cache.set(key, { value, at: Date.now() });
    return value;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Measure every leg of an ordered list of stops.
 *
 * Never throws for one bad leg: a stop without a pin, or a lookup that fails,
 * comes back as a leg the operator still has to fill in themselves. Half a
 * route measured is more useful than an error.
 */
export async function measureLegs(stops) {
  const legs = [];

  for (let i = 0; i < stops.length; i += 1) {
    const stop = stops[i];

    if (i === 0) {
      // Nothing precedes the origin, so its inbound leg is always zero.
      legs.push({ checkpointId: stop.id, name: stop.name, baselineMinutes: 0, measured: true });
      continue;
    }

    const prev = stops[i - 1];
    const base = { checkpointId: stop.id, name: stop.name, from: prev.name };

    if (!prev.location?.lat || !stop.location?.lat) {
      legs.push({
        ...base,
        measured: false,
        reason: 'One of these stops has no pin on the map yet.',
      });
      continue;
    }

    try {
      const { minutes, km } = await typicalMinutes(prev.location, stop.location);
      const dwell = DWELL_MINUTES[stop.type] ?? 0;
      legs.push({
        ...base,
        measured: true,
        baselineMinutes: Math.round(minutes + dwell),
        drivingMinutes: Math.round(minutes),
        dwellMinutes: dwell,
        km: Math.round(km * 10) / 10,
      });
    } catch (err) {
      legs.push({ ...base, measured: false, reason: err.message });
    }
  }

  return legs;
}
