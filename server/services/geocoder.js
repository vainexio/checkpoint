/**
 * Place-name lookup, so an operator can type "Balintawak" instead of hunting
 * for a spot on the map.
 *
 * This uses OpenStreetMap's Nominatim, which costs nothing and needs no key —
 * it is entirely separate from the traffic provider, so nothing here consumes
 * the TomTom quota. What it does have is a usage policy, and we honour it:
 *
 *   - at most one request per second, serialised through a queue
 *   - a real User-Agent identifying this application
 *   - results cached, so retyping a query never re-asks
 *   - biased to the Philippines, since every checkpoint is there
 *
 * If the lookup fails the admin can still drop a pin by clicking the map, so
 * this is a convenience, never a dependency.
 */

const ENDPOINT = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'CHECKPOINT-bus-eta-tracker/1.0 (https://github.com/vainexio/checkpoint)';

const MIN_INTERVAL_MS = 1100; // Nominatim asks for <= 1 req/sec. Stay under it.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // Places do not move.
const REQUEST_TIMEOUT_MS = 8000;

const cache = new Map();
let lastRequestAt = 0;
let queue = Promise.resolve();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Serialise every call and space them out, whoever asks. */
function polite(task) {
  const run = queue.then(async () => {
    const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
    return task();
  });
  // Keep the chain alive even when one lookup rejects.
  queue = run.catch(() => {});
  return run;
}

/**
 * A human-readable area for a hit.
 *
 * The raw display_name is a long comma-chain that often starts with a street
 * number, so slicing it blindly yields things like "1, Kennedy Road". The
 * structured address gives the parts a passenger would actually recognise.
 */
function describeArea(hit) {
  const a = hit.address ?? {};
  const locality = a.city ?? a.town ?? a.municipality ?? a.village ?? a.suburb ?? a.county;
  const region = a.state ?? a.region ?? a.province;

  const parts = [locality, region].filter(Boolean);
  if (parts.length) return [...new Set(parts)].join(', ');

  // Fall back to the display chain, skipping any leading house number.
  return hit.display_name
    .split(',')
    .slice(1)
    .map((p) => p.trim())
    .filter((p) => p && !/^\d+$/.test(p))
    .slice(0, 2)
    .join(', ');
}

/**
 * Say what OpenStreetMap thinks a place actually is.
 *
 * This is the guard against the most damaging kind of bad data here. Searching
 * "Santo Tomas, Batangas" returns the municipal hall, and siting a checkpoint
 * there puts the pin where no bus goes, sends walking directions to a town
 * hall, and makes the measured leg detour off the highway — so the baseline is
 * wrong as well as the map. Naming the kind lets an operator see the difference
 * before they place it.
 */
function classify(hit) {
  const t = `${hit.category}=${hit.type}`;

  if (hit.type === 'bus_station' || t === 'amenity=bus_station') {
    return { isTransit: true, kind: 'Bus terminal' };
  }
  if (hit.type === 'bus_stop' || t === 'highway=bus_stop') {
    return { isTransit: true, kind: 'Roadside bus stop' };
  }
  if (hit.category === 'public_transport' || hit.type === 'station') {
    return { isTransit: true, kind: 'Transport station' };
  }
  if (['city', 'town', 'municipality', 'village', 'administrative'].includes(hit.type)) {
    return { isTransit: false, kind: 'Town centre — buses may not stop here' };
  }
  return { isTransit: false, kind: 'Not a recognised stop' };
}

/**
 * Search near a point rather than everywhere, so "bus terminal" finds the one
 * on this corridor instead of one three provinces away.
 */
export async function findTerminalsNear({ lat, lng, radiusDeg = 0.06, limit = 8 }) {
  const viewbox = [lng - radiusDeg, lat + radiusDeg, lng + radiusDeg, lat - radiusDeg].join(',');
  const hits = await geocode('bus terminal', { limit, viewbox });
  return hits.filter((h) => h.isTransit);
}

export async function geocode(query, { limit = 5, viewbox = null } = {}) {
  const q = String(query || '').trim();
  if (q.length < 3) return [];

  const key = `${q.toLowerCase()}|${viewbox ?? ''}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.results;

  const url =
    `${ENDPOINT}?format=jsonv2&limit=${limit}` +
    `&countrycodes=ph&addressdetails=1&q=${encodeURIComponent(q)}` +
    // Bounded to a corridor when given, so "bus terminal" finds the local one.
    (viewbox ? `&viewbox=${viewbox}&bounded=1` : '');

  const results = await polite(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en' },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Nominatim responded ${res.status}`);

      const body = await res.json();
      return body
        .map((hit) => ({
          label: hit.display_name,
          // The leading component is the recognisable bit; the rest is context.
          name: hit.display_name.split(',')[0].trim(),
          area: describeArea(hit),
          type: hit.type,
          category: hit.category,
          ...classify(hit),
          location: { lat: Number(hit.lat), lng: Number(hit.lon) },
        }))
        // Real terminals first. A search for a town otherwise returns its
        // municipal hall, and that is exactly the place a bus never goes.
        .sort((a, b) => Number(b.isTransit) - Number(a.isTransit));
    } finally {
      clearTimeout(timer);
    }
  });

  cache.set(key, { results, at: Date.now() });
  return results;
}
