/**
 * The last thing a staff screen loaded, kept on the phone.
 *
 * A conductor who opens the app with no signal should see their trip, not a
 * spinner that never ends — the buttons work offline, so the screen they sit
 * on has to as well. What is shown from here is always labelled with when it
 * was saved; it is a snapshot, never passed off as live.
 *
 * Keys include the account, so a phone handed from one conductor to another
 * never shows the first one's trips. Everything is cleared on sign-out.
 */

const PREFIX = 'checkpoint.snapshot.';

export function readSnapshot(key) {
  if (!key) return null;
  try {
    const value = JSON.parse(localStorage.getItem(PREFIX + key) ?? 'null');
    return value && 'data' in value ? value : null;
  } catch {
    return null;
  }
}

export function writeSnapshot(key, data) {
  if (!key) return;
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ data, savedAt: new Date().toISOString() }));
  } catch {
    /* Storage full or unavailable: the screen still works while online. */
  }
}

export function clearSnapshots() {
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(PREFIX)) localStorage.removeItem(key);
    }
  } catch {
    /* nothing to clear */
  }
}
