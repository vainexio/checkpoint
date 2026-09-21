/**
 * Slowing down password guessing.
 *
 * Two counters, because there are two ways to guess. One account tried from
 * many places is caught per username; one place trying many accounts is caught
 * per address. Each only counts failures, and a successful sign-in clears the
 * account's count, so a conductor who mistypes twice and then gets it right is
 * never held up.
 *
 * Held in memory. This deployment is one process, and the cost of a restart
 * forgetting the counts is a guesser getting a fresh handful of tries — far
 * cheaper than a database write on every failed sign-in. A deployment running
 * several instances would move this into a shared store.
 */

const WINDOW_MS = 15 * 60 * 1000;

/** Failures allowed per account in the window before it is held. */
export const ACCOUNT_LIMIT = 5;
/** Failures allowed from one address, across all accounts. */
export const ADDRESS_LIMIT = 20;

/** key -> { failures: [timestamps], lockedUntil } */
const buckets = new Map();

const recent = (entry, now) => (entry?.failures ?? []).filter((t) => now - t < WINDOW_MS);

/**
 * Whether an attempt may go ahead. Returns the seconds to wait when it may not,
 * so the response can say how long rather than just "no".
 */
export function checkAttempt({ account, address }, now = Date.now()) {
  let wait = 0;
  for (const key of keysFor({ account, address })) {
    const entry = buckets.get(key);
    if (entry?.lockedUntil > now) wait = Math.max(wait, entry.lockedUntil - now);
  }
  return wait > 0 ? { allowed: false, retryAfterSeconds: Math.ceil(wait / 1000) } : { allowed: true };
}

export function recordFailure({ account, address }, now = Date.now()) {
  for (const key of keysFor({ account, address })) {
    const entry = { failures: [...recent(buckets.get(key), now), now], lockedUntil: 0 };
    const limit = key.startsWith('account:') ? ACCOUNT_LIMIT : ADDRESS_LIMIT;
    // Held for a full window from the failure that crossed the line.
    if (entry.failures.length >= limit) entry.lockedUntil = now + WINDOW_MS;
    buckets.set(key, entry);
  }
}

/** A correct password: the account starts clean. The address keeps its count. */
export function recordSuccess({ account }) {
  if (account) buckets.delete(`account:${account}`);
}

function keysFor({ account, address }) {
  const keys = [];
  if (account) keys.push(`account:${account}`);
  if (address) keys.push(`address:${address}`);
  return keys;
}

export const tooManyAttempts = (retryAfterSeconds) => {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`;
};

/** Test seam. */
export const resetLoginThrottle = () => buckets.clear();
