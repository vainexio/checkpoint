/**
 * Find real bus terminals, rather than geocoding a city name.
 *
 * Searching "Santo Tomas, Batangas" returns the municipal centre — a place no
 * bus on the STAR Tollway ever goes. A checkpoint has to be somewhere a bus
 * genuinely stops and opens its doors, otherwise the pin is wrong, the walking
 * directions send someone to a town hall, and the measured leg includes a
 * detour the bus never makes.
 *
 * OpenStreetMap tags these properly, so ask for the tag instead of the name:
 *   amenity=bus_station   a terminal building or yard
 *   highway=bus_stop      a roadside stop
 *   public_transport=station / platform
 *
 * Overpass is free and needs no key, same as Nominatim.
 *
 *   node scripts/findTerminals.js
 */
const OVERPASS = 'https://overpass-api.de/api/interpreter';

// Search around each corridor town. Radius is generous because a highway stop
// often sits well outside the town centre — which is the entire point.
const PLACES = [
  { label: 'Cubao / Araneta', lat: 14.6217, lng: 121.053, radius: 2500 },
  { label: 'Balintawak', lat: 14.6574, lng: 121.0039, radius: 2500 },
  { label: 'Tarlac City', lat: 15.4869, lng: 120.5899, radius: 6000 },
  { label: 'Baguio', lat: 16.4138, lng: 120.5914, radius: 4000 },
  { label: 'PITX / Parañaque', lat: 14.5099, lng: 120.9914, radius: 2500 },
  { label: 'Alabang', lat: 14.419, lng: 121.0443, radius: 4000 },
  { label: 'Calamba', lat: 14.194, lng: 121.1597, radius: 7000 },
  { label: 'Santo Tomas', lat: 14.1107, lng: 121.1424, radius: 7000 },
  { label: 'Tanauan', lat: 14.0866, lng: 121.1259, radius: 7000 },
  { label: 'Lipa', lat: 13.9572, lng: 121.1646, radius: 7000 },
];

const query = ({ lat, lng, radius }) => `
[out:json][timeout:25];
(
  node["amenity"="bus_station"](around:${radius},${lat},${lng});
  way["amenity"="bus_station"](around:${radius},${lat},${lng});
  node["public_transport"="station"]["bus"="yes"](around:${radius},${lat},${lng});
  way["public_transport"="station"]["bus"="yes"](around:${radius},${lat},${lng});
);
out center tags;`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (const place of PLACES) {
  try {
    const res = await fetch(OVERPASS, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query(place))}`,
    });

    if (!res.ok) {
      console.log(`${place.label}: Overpass ${res.status}`);
      await sleep(2000);
      continue;
    }

    const { elements = [] } = await res.json();
    console.log(`\n=== ${place.label} (${elements.length} found) ===`);

    for (const el of elements.slice(0, 6)) {
      const lat = el.lat ?? el.center?.lat;
      const lon = el.lon ?? el.center?.lon;
      const t = el.tags ?? {};
      console.log(
        `  ${(t.name ?? '(unnamed)').padEnd(42)} ${lat?.toFixed(6)}, ${lon?.toFixed(6)}` +
          `  [${t.amenity ?? t.public_transport ?? '?'}]${t.operator ? ' · ' + t.operator : ''}`
      );
    }
  } catch (err) {
    console.log(`${place.label}: ${err.message}`);
  }

  // Overpass is a shared free service; do not hammer it.
  await sleep(2500);
}
