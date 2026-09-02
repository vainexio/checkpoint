import test from 'node:test';
import assert from 'node:assert/strict';

import { locate, metresBetween } from '../src/utils/locate.js';

/**
 * These exist because forcing `enableHighAccuracy` once already broke desktops
 * while fixing phones — a fix that looked strictly better and was not. The rule
 * that keeps both working is that a later fix only wins by being tighter, and
 * that rule is easy to lose in a refactor, so it is pinned here.
 *
 * No browser needed: `locate` reads `navigator.geolocation` when called, so a
 * plain object stands in for the device.
 */

const fix = (accuracy, lat = 14.6, lng = 121.0) => ({
  coords: { latitude: lat, longitude: lng, accuracy },
});

/**
 * @param fast       what getCurrentPosition answers, or null to make it fail
 * @param sharp      the sequence watchPosition emits
 * @param sharpError an error for watchPosition instead of any fixes
 */
function useDevice({ fast = null, sharp = [], sharpError = null }) {
  const device = {
    geolocation: {
      getCurrentPosition(ok, err) {
        if (fast) setTimeout(() => ok(fast), 5);
        else setTimeout(() => err({ code: 2 }), 5);
      },
      watchPosition(ok, err) {
        if (sharpError) setTimeout(() => err(sharpError), 20);
        else sharp.forEach((p, i) => setTimeout(() => ok(p), 20 + i * 10));
        return 1;
      },
      clearWatch() {},
    },
  };
  Object.defineProperty(globalThis, 'navigator', {
    value: device,
    configurable: true,
    writable: true,
  });
}

/** Run one locating session and report the accuracies it accepted, in order. */
const accepted = (setup) =>
  new Promise((resolve) => {
    useDevice(setup);
    const seen = [];
    locate({
      onFix: (f) => seen.push(Math.round(f.accuracyM)),
      onError: (e) => seen.push({ error: e }),
      onSettle: () => resolve(seen),
    });
  });

test('a coarse refinement never replaces a good fix', async () => {
  // The desktop case: a WiFi fix good to 400 m, then high accuracy falls back
  // to an IP lookup 18 km wide. Taking the newer answer is the regression.
  assert.deepEqual(await accepted({ fast: fix(400), sharp: [fix(18000)] }), [400]);
});

test('a refinement that fails outright leaves the fix we already had', async () => {
  assert.deepEqual(await accepted({ fast: fix(400), sharpError: { code: 3 } }), [400]);
});

test('a phone sharpens from the network fix to GPS', async () => {
  assert.deepEqual(await accepted({ fast: fix(1200), sharp: [fix(140), fix(12)] }), [1200, 140, 12]);
});

test('a first fix that fails does not stop a later one from landing', async () => {
  // Phones commonly refuse the cached answer and satisfy only the sharp pass.
  assert.deepEqual(await accepted({ fast: null, sharp: [fix(25)] }), [25]);
});

test('losing both sources reports an error rather than nothing', async () => {
  const seen = await accepted({ fast: null, sharpError: { code: 1 } });
  assert.equal(seen.length, 1);
  assert.match(seen[0].error, /permission was declined/i);
});

test('metresBetween measures the ground a refinement actually moved', () => {
  const a = { lat: 14.6, lng: 121.0 };
  assert.equal(Math.round(metresBetween(a, a)), 0);
  // A hundredth of a degree of latitude is roughly 1.1 km anywhere.
  assert.ok(Math.abs(metresBetween(a, { lat: 14.61, lng: 121.0 }) - 1113) < 15);
  assert.equal(metresBetween(null, a), Infinity);
});
