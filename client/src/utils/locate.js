/**
 * Find the passenger, without betting on what kind of device they are holding.
 *
 * Asking for one fix means choosing a loser in advance. A plain request is fast
 * and, on a laptop, usually a WiFi-derived fix good to a street; asking for high
 * accuracy is what makes a phone turn its GPS on, but on a machine with no GPS
 * it also rejects the cached WiFi answer and waits for a precise provider that
 * does not exist — then falls back to an IP lookup that can be a province out.
 * Forcing high accuracy therefore fixed phones and broke desktops.
 *
 * So: take the fast answer first, then let a better one overtake it. The rule
 * that makes this safe is that a later fix only wins if its accuracy is
 * genuinely smaller. A desktop keeps the good WiFi fix it had; a phone starts
 * with something on screen and sharpens to GPS a moment later.
 *
 * Nothing here is stored or sent anywhere. This is the rider's own phone
 * locating itself to rank nearby stops — never a bus, which is the whole point
 * of this system.
 */

/** Good enough that waiting for better is not worth the battery. */
const GOOD_ENOUGH_METRES = 50;

/** How long to keep listening for a sharper fix before giving up on one. */
const REFINE_WINDOW_MS = 12000;

const FAST = { enableHighAccuracy: false, timeout: 8000, maximumAge: 120000 };
const SHARP = { enableHighAccuracy: true, timeout: REFINE_WINDOW_MS, maximumAge: 0 };

const toFix = (position) => ({
  lat: position.coords.latitude,
  lng: position.coords.longitude,
  // Metres of radius. Kept because a fix without it cannot be judged, and an
  // unjudged fix gets drawn as confidently as a good one.
  accuracyM: position.coords.accuracy ?? null,
});

const describe = (err) =>
  err?.code === 1
    ? 'Location permission was declined. You can still search or use the map.'
    : 'Could not get your location. You can still search or use the map.';

/**
 * @param onFix    called with each fix that is better than the last
 * @param onError  called only if nothing was found at all
 * @param onSettle called once when no further improvement is coming
 * @returns a cancel function
 */
export function locate({ onFix, onError, onSettle } = {}) {
  if (!navigator.geolocation) {
    onError?.('This browser cannot share a location.');
    onSettle?.();
    return () => {};
  }

  let best = null;
  let watchId = null;
  let timer = null;
  let done = false;

  const stop = () => {
    if (done) return;
    done = true;
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    if (timer) clearTimeout(timer);
    onSettle?.();
  };

  // A fix wins only by being measurably tighter. Without this the refinement
  // pass could quietly replace a good fix with a worse one, which is exactly
  // the failure it exists to prevent.
  const offer = (fix) => {
    if (done) return;
    const better =
      !best ||
      best.accuracyM === null ||
      (fix.accuracyM !== null && fix.accuracyM < best.accuracyM);
    if (!better) return;

    best = fix;
    onFix?.(fix);
    if (fix.accuracyM !== null && fix.accuracyM <= GOOD_ENOUGH_METRES) stop();
  };

  navigator.geolocation.getCurrentPosition(
    (position) => offer(toFix(position)),
    // Not fatal on its own: the sharp pass below may still succeed, and on a
    // phone it is the one that was always going to answer.
    () => {},
    FAST
  );

  watchId = navigator.geolocation.watchPosition(
    (position) => offer(toFix(position)),
    (err) => {
      if (!best) onError?.(describe(err));
      stop();
    },
    SHARP
  );

  timer = setTimeout(() => {
    if (!best) onError?.(describe(null));
    stop();
  }, REFINE_WINDOW_MS);

  return stop;
}

/** Metres between two fixes, for deciding whether a refinement matters. */
export function metresBetween(a, b) {
  if (!a || !b) return Infinity;
  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
