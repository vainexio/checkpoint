/**
 * Measure a route's real geography instead of guessing it.
 *
 * Given a list of place names, this geocodes each one (OpenStreetMap, free) and
 * then asks TomTom how long each leg takes with no traffic on it. Free-flow is
 * the right number for a baseline: the baseline is what a segment *usually*
 * costs, and the live traffic layer exists precisely to say how today differs
 * from that. Seeding baselines from a congested measurement would bake one
 * afternoon's jam into the route forever.
 *
 * A few minutes of dwell is added at each stop where passengers board, because
 * a bus does not pass a terminal at speed.
 *
 *   node scripts/measureRoute.js
 *
 * Prints a ready-to-paste checkpoint array. Requires TRAFFIC_API_KEY.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

dotenv.config({
  path: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env'),
});

import { geocode } from '../services/geocoder.js';

const DWELL_MINUTES = { station: 4, landmark: 0 };

/** Places to measure, in the order a bus drives them. */
const ROUTES = {
  'PITX – Lipa': [
    { query: 'Parañaque Integrated Terminal Exchange', name: 'PITX', type: 'station', terminal: true },
    { query: 'Alabang, Muntinlupa', name: 'Alabang', type: 'station' },
    { query: 'Calamba City Hall, Calamba, Laguna', name: 'Calamba Crossing', type: 'station' },
    { query: 'Santo Tomas City Hall, Batangas', name: 'Santo Tomas', type: 'station' },
    { query: 'Tanauan City Hall, Tanauan, Batangas', name: 'Tanauan', type: 'station' },
    { query: 'Lipa City Hall, Batangas', name: 'Lipa City', type: 'station', terminal: true },
  ],
  'Cubao – Baguio': [
    { query: 'Araneta City Bus Port, Cubao, Quezon City', name: 'Cubao Terminal', type: 'station', terminal: true },
    { query: 'Balintawak, Quezon City', name: 'Balintawak', type: 'station' },
    { query: 'Tarlac City Hall, Tarlac', name: 'Tarlac stop', type: 'station' },
    { query: 'Rosario, La Union', name: 'TPLEX – Rosario Exit', type: 'landmark' },
    { query: 'Baguio City Hall, Baguio', name: 'Baguio Terminal', type: 'station', terminal: true },
  ],
};

async function freeFlowMinutes(from, to) {
  const url =
    `https://api.tomtom.com/routing/1/calculateRoute/` +
    `${from.lat},${from.lng}:${to.lat},${to.lng}/json` +
    `?key=${process.env.TRAFFIC_API_KEY}&traffic=true&travelMode=bus&routeType=fastest` +
    // Without this TomTom returns only the live time, and the breakdown fields
    // come back undefined.
    `&computeTravelTimeFor=all`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`TomTom ${res.status}`);

  const summary = (await res.json()).routes?.[0]?.summary;
  if (summary.historicTrafficTravelTimeInSeconds == null) {
    throw new Error('TomTom returned no historic time — is computeTravelTimeFor=all set?');
  }

  return {
    /**
     * The baseline is the *typical* time, not the best possible one.
     *
     * Free-flow is what an empty road costs, which a bus in Metro Manila never
     * achieves — using it would leave every trip permanently "late" and make
     * the delayed status meaningless. Historic is what this leg normally takes,
     * so variance reads as "worse than usual", which is the thing anyone
     * actually wants to know.
     */
    typical: summary.historicTrafficTravelTimeInSeconds / 60,
    freeFlow: summary.noTrafficTravelTimeInSeconds / 60,
    live: summary.travelTimeInSeconds / 60,
    km: summary.lengthInMeters / 1000,
  };
}

for (const [routeName, places] of Object.entries(ROUTES)) {
  console.log(`\n=== ${routeName} ===\n`);

  const located = [];
  for (const place of places) {
    const [hit] = await geocode(place.query, { limit: 1 });
    if (!hit) {
      console.error(`  !! could not locate ${place.query}`);
      continue;
    }
    located.push({ ...place, location: hit.location, area: hit.area });
    console.log(`  ${place.name.padEnd(20)} ${hit.location.lat}, ${hit.location.lng}  (${hit.area})`);
  }

  console.log('\n  legs:');
  const rows = [];
  for (let i = 0; i < located.length; i += 1) {
    if (i === 0) {
      rows.push({ ...located[i], baseline: 0 });
      continue;
    }
    const leg = await freeFlowMinutes(located[i - 1].location, located[i].location);
    const dwell = DWELL_MINUTES[located[i].type] ?? 0;
    const baseline = Math.round(leg.typical + dwell);

    console.log(
      `  ${located[i - 1].name} → ${located[i].name}: ` +
        `${leg.km.toFixed(1)} km · typical ${leg.typical.toFixed(0)}m ` +
        `(+${dwell} dwell) = ${baseline}m · free-flow ${leg.freeFlow.toFixed(0)}m ` +
        `· live now ${leg.live.toFixed(0)}m`
    );
    rows.push({ ...located[i], baseline });
  }

  console.log('\n  paste into seed.js:\n');
  console.log(
    JSON.stringify(
      rows.map((r) => ({
        name: r.name,
        type: r.type,
        isTerminal: !!r.terminal,
        area: r.area,
        location: r.location,
        baseline: r.baseline,
      })),
      null,
      2
    )
  );
  console.log(`\n  total baseline: ${rows.reduce((s, r) => s + r.baseline, 0)} min`);
}
