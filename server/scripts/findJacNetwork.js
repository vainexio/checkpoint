/**
 * Locate JAC Liner's real network, terminal by terminal.
 *
 * Their published map draws the distinction this system needs: a handful of
 * **major terminals** where buses are based and tickets are sold, and a longer
 * list of **pick-up and drop-off points** along the highway where the bus
 * simply stops. Both are checkpoints; only the first is somewhere you would
 * choose to wait for an hour.
 *
 * Terminals are searched by name. Drop-off towns are searched *bounded to the
 * town*, because the point on the Maharlika Highway is what matters, not the
 * municipal hall a plain name search returns.
 *
 *   node scripts/findJacNetwork.js
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

dotenv.config({
  path: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env'),
});

import { geocode, findTerminalsNear } from '../services/geocoder.js';

/** JAC's own terminals, searched by name. */
const TERMINALS = [
  'JAC Liner Terminal, Kamias, Quezon City',
  'Mapagmahal Street, Kamias, Quezon City',
  'JAC Liner Buendia Terminal, Pasay',
  'Lucena Grand Central Terminal',
  'One Ayala Terminal, Makati',
  'Market! Market!, Taguig',
  'JAC Liner, Biñan, Laguna',
];

/**
 * Towns JAC lists as pick-up and drop-off along the Lucena run. Roughly the
 * town centre, used only as a search anchor — the point we actually want is
 * the highway stop nearby.
 */
const DROPOFF_TOWNS = [
  { name: 'Sto. Tomas', lat: 14.1078, lng: 121.1424 },
  { name: 'Alaminos, Laguna', lat: 14.0636, lng: 121.2447 },
  { name: 'San Pablo', lat: 14.0683, lng: 121.3256 },
  { name: 'Tiaong', lat: 13.9553, lng: 121.3231 },
  { name: 'Candelaria', lat: 13.9312, lng: 121.4237 },
  { name: 'Sariaya', lat: 13.9647, lng: 121.5261 },
  { name: 'Lucena City', lat: 13.9314, lng: 121.6176 },
];

console.log('=== JAC terminals (by name) ===');
for (const q of TERMINALS) {
  const hits = await geocode(q, { limit: 2 });
  if (!hits.length) {
    console.log(`  ${q}\n     (nothing)`);
    continue;
  }
  console.log(`  ${q}`);
  for (const h of hits) {
    console.log(
      `     ${h.location.lat.toFixed(6)}, ${h.location.lng.toFixed(6)}  ` +
        `[${h.isTransit ? 'TRANSIT' : 'not'}] ${h.kind} — ${h.name}`
    );
  }
}

console.log('\n=== pick-up / drop-off points (bounded to each town) ===');
for (const town of DROPOFF_TOWNS) {
  const hits = await findTerminalsNear({ lat: town.lat, lng: town.lng, radiusDeg: 0.05, limit: 5 });
  console.log(`  ${town.name}`);
  if (!hits.length) {
    console.log('     no tagged transit facility — would need a manual pin');
    continue;
  }
  for (const h of hits.slice(0, 3)) {
    console.log(
      `     ${h.location.lat.toFixed(6)}, ${h.location.lng.toFixed(6)}  ${h.kind} — ${h.name}`
    );
  }
}
