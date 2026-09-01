/**
 * Walking directions to a stop.
 *
 * This hands off to whatever maps app the viewer already has rather than
 * routing in-app. That is deliberate: turn-by-turn with live rerouting is a
 * product in itself, their app already does it better, it works offline once
 * cached, and it costs us no API key and no quota. CHECKPOINT's job is to say
 * which stop to walk to, not to be a maps product.
 */
export function directionsUrl(destination, from = null) {
  if (!destination?.lat) return null;

  const to = `${destination.lat},${destination.lng}`;
  const params = new URLSearchParams({
    api: '1',
    destination: to,
    travelmode: 'walking',
  });

  // Passing the origin makes the route appear immediately instead of asking
  // the app to locate the user again.
  if (from?.lat) params.set('origin', `${from.lat},${from.lng}`);

  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

/** Roughly how long that walk takes, at an unhurried 4.5 km/h. */
export function walkMinutes(distanceKm) {
  if (distanceKm == null) return null;
  return Math.max(1, Math.round((distanceKm / 4.5) * 60));
}
