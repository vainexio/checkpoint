/**
 * Measure each leg between the *actual* stops a bus uses.
 *
 * The coordinates below are not city centres. Geocoding "Santo Tomas, Batangas"
 * returns the municipal hall — a place no bus on the Maharlika Highway ever
 * goes — which puts the pin where passengers cannot wait, sends walking
 * directions to a town hall, and makes TomTom measure a leg that detours off
 * the highway and back. Every point here is a real terminal, verified against
 * OpenStreetMap's `amenity=bus_station` tag (see scripts/findTerminals.js),
 * except where noted.
 *
 * Baselines use TomTom's *historic* time — what the leg typically takes — plus
 * dwell where passengers board. Not free-flow: an empty road is a time a bus in
 * Metro Manila never achieves, and measuring against it would leave every trip
 * permanently "late".
 *
 *   node scripts/measureRoute.js
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

dotenv.config({
  path: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env'),
});

const DWELL_MINUTES = { station: 4, landmark: 0 };

/** Verified stops. `osm` records what OpenStreetMap calls the place. */
const STOPS = {
  araneta: {
    name: 'Araneta City Bus Station',
    area: 'Cubao, Quezon City',
    location: { lat: 14.621413, lng: 121.055331 },
    osm: 'amenity=bus_station',
  },
  balintawak: {
    name: 'Balintawak Interchange',
    area: 'EDSA Cloverleaf, Quezon City',
    location: { lat: 14.6574221, lng: 121.0038959 },
    // A roadside pick-up point on EDSA before NLEX, not a terminal building —
    // OSM has no bus_station here, but buses genuinely stop and board.
    osm: 'roadside stop (no OSM terminal)',
  },
  tarlac: {
    name: 'Victory Liner Tarlac Terminal',
    area: 'Tarlac City, Tarlac',
    location: { lat: 15.480646, lng: 120.594583 },
    osm: 'amenity=bus_station',
  },
  tplex: {
    name: 'TPLEX – Rosario Exit',
    area: 'Rosario, La Union',
    location: { lat: 16.2299397, lng: 120.487704 },
    // A toll exit. Buses pass it at speed; nobody boards.
    osm: 'toll exit (timing point only)',
    type: 'landmark',
  },
  baguio: {
    name: 'Genesis Bus Terminal Baguio',
    area: 'Governor Pack Road, Baguio',
    location: { lat: 16.410282, lng: 120.598534 },
    osm: 'amenity=bus_station',
  },

  pitx: {
    name: 'PITX',
    area: 'Parañaque, Metro Manila',
    location: { lat: 14.509965, lng: 120.991373 },
    osm: 'Parañaque Integrated Terminal Exchange',
  },
  alabang: {
    name: 'Alabang South Station',
    area: 'Filinvest City, Muntinlupa',
    location: { lat: 14.421736, lng: 121.043574 },
    osm: 'amenity=bus_station',
  },
  turbina: {
    name: 'Turbina Bus Terminal',
    area: 'Maharlika Highway, Calamba, Laguna',
    location: { lat: 14.186853, lng: 121.13603 },
    // The real Calamba stop is on the highway at Turbina, ~3 km from the city
    // hall a name search returns.
    osm: 'amenity=bus_station',
  },
  santoTomas: {
    name: 'SM Santo Tomas Terminal',
    area: 'Maharlika Highway, Santo Tomas, Batangas',
    location: { lat: 14.105756, lng: 121.152073 },
    osm: 'amenity=bus_station',
  },
  tanauan: {
    name: 'Tanauan City Transport Terminal',
    area: 'Tanauan, Batangas',
    location: { lat: 14.082933, lng: 121.145362 },
    osm: 'amenity=bus_station',
  },
  lipa: {
    name: 'Lipa City Grand Terminal',
    area: 'Lipa, Batangas',
    location: { lat: 13.954528, lng: 121.161748 },
    osm: 'amenity=bus_station',
  },
};

const ROUTES = {
  'Cubao – Baguio': ['araneta', 'balintawak', 'tarlac', 'tplex', 'baguio'],
  'Baguio – Cubao': ['baguio', 'tplex', 'tarlac', 'balintawak', 'araneta'],
  'PITX – Lipa': ['pitx', 'alabang', 'turbina', 'santoTomas', 'tanauan', 'lipa'],
  'Lipa – PITX': ['lipa', 'tanauan', 'santoTomas', 'turbina', 'alabang', 'pitx'],
};

async function legMinutes(from, to) {
  const url =
    `https://api.tomtom.com/routing/1/calculateRoute/` +
    `${from.lat},${from.lng}:${to.lat},${to.lng}/json` +
    `?key=${process.env.TRAFFIC_API_KEY}&traffic=true&travelMode=bus&routeType=fastest` +
    // Without this TomTom returns only the live time and the breakdown fields
    // come back undefined.
    `&computeTravelTimeFor=all`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`TomTom ${res.status}`);

  const s = (await res.json()).routes?.[0]?.summary;
  if (s?.historicTrafficTravelTimeInSeconds == null) {
    throw new Error('No historic time — is computeTravelTimeFor=all set?');
  }

  return {
    typical: s.historicTrafficTravelTimeInSeconds / 60,
    freeFlow: s.noTrafficTravelTimeInSeconds / 60,
    live: s.travelTimeInSeconds / 60,
    km: s.lengthInMeters / 1000,
  };
}

for (const [routeName, keys] of Object.entries(ROUTES)) {
  console.log(`\n=== ${routeName} ===`);
  const rows = [];

  for (let i = 0; i < keys.length; i += 1) {
    const stop = STOPS[keys[i]];
    if (i === 0) {
      rows.push({ key: keys[i], baseline: 0 });
      continue;
    }

    const prev = STOPS[keys[i - 1]];
    const leg = await legMinutes(prev.location, stop.location);
    const dwell = DWELL_MINUTES[stop.type ?? 'station'] ?? 0;
    const baseline = Math.round(leg.typical + dwell);

    console.log(
      `  ${prev.name} → ${stop.name}: ${leg.km.toFixed(1)} km · ` +
        `typical ${leg.typical.toFixed(0)}m (+${dwell} dwell) = ${baseline}m`
    );
    rows.push({ key: keys[i], baseline });
  }

  const total = rows.reduce((s, r) => s + r.baseline, 0);
  console.log(`  → ${Math.floor(total / 60)}h ${String(total % 60).padStart(2, '0')}m total`);
  console.log(`  baselines: [${rows.map((r) => r.baseline).join(', ')}]`);
}
