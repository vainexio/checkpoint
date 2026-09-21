import { TomTomError } from './tomtomError.js';

/**
 * The traffic API keys, taken in turn, with a refused one set aside.
 *
 * Keys come from the environment as TRAFFIC_API_KEY1, TRAFFIC_API_KEY2, … —
 * any number of them, in number order, gaps allowed, so adding a third is one
 * line of configuration and no code. The unnumbered TRAFFIC_API_KEY is still
 * read, but only when no numbered key exists, so a deployment moving to
 * numbered keys cannot quietly keep using the old one as well.
 *
 * Requests rotate across the keys, so their free allowances are drawn down
 * together rather than one after another. When a key is refused for something
 * that will not change on the next request — out of credits, unauthorised,
 * rate-limited — it is set aside for as long as the refusal calls for and the
 * same request is retried on the next key. Only when every key is resting
 * does the caller hear about it.
 *
 * Key values never leave this module except inside the request URL. Status,
 * logs and errors name a key by its variable, never by what it contains.
 */

const NUMBERED = /^TRAFFIC_API_KEY(\d+)$/;

/** [{ name, value }] in the order they are used. */
export function readTrafficKeys(env = process.env) {
  const numbered = Object.entries(env)
    .map(([name, value]) => ({
      name,
      n: Number(NUMBERED.exec(name)?.[1]),
      value: String(value ?? '').trim(),
    }))
    .filter((k) => Number.isInteger(k.n) && k.value)
    .sort((a, b) => a.n - b.n);

  // The same key pasted twice is one allowance, not two.
  const seen = new Set();
  const keys = [];
  for (const { name, value } of numbered) {
    if (seen.has(value)) continue;
    seen.add(value);
    keys.push({ name, value });
  }
  if (keys.length) return keys;

  const legacy = String(env.TRAFFIC_API_KEY ?? '').trim();
  return legacy ? [{ name: 'TRAFFIC_API_KEY', value: legacy }] : [];
}

export const hasTrafficKey = (env = process.env) => readTrafficKeys(env).length > 0;

/** name -> { until, reason } */
const resting = new Map();
let turn = 0;

const isResting = (name, now) => (resting.get(name)?.until ?? 0) > now;

/**
 * Run one provider request with whichever key is up next.
 *
 * `request(key)` performs the call. A failure that belongs to the key (it has
 * `pauseMs`, see tomtomError.js) rests that key and moves on to the next; any
 * other failure belongs to this request and is thrown as it is.
 */
export async function withTrafficKey(request, { env = process.env, now = Date.now } = {}) {
  const keys = readTrafficKeys(env);
  if (!keys.length) throw new Error('No traffic API key is configured.');

  const start = turn;
  turn = (turn + 1) % keys.length;
  let lastRefusal = null;

  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[(start + i) % keys.length];
    if (isResting(key.name, now())) continue;

    try {
      return await request(key.value);
    } catch (err) {
      if (!(err?.pauseMs > 0)) throw err;

      const reason = err.code ?? `HTTP ${err.status}`;
      resting.set(key.name, { until: now() + err.pauseMs, reason });
      const left = keys.filter((k) => !isResting(k.name, now())).length;
      console.warn(
        `[traffic] ${key.name} refused (${reason}) — resting it for ` +
          `${Math.round(err.pauseMs / 60000)}m; ${left ? `${left} other key${left === 1 ? '' : 's'} left` : 'no keys left'}`
      );
      lastRefusal = err;
    }
  }

  // Every key is resting. Say until when, so the caller can stop asking until
  // the first of them is back rather than hammering all of them.
  const soonest = Math.min(...keys.map((k) => resting.get(k.name)?.until ?? now()));
  const err = new TomTomError({
    status: lastRefusal?.status ?? 403,
    code: lastRefusal?.code ?? resting.get(keys[0].name)?.reason ?? 'AllKeysResting',
    pauseMs: Math.max(soonest - now(), 60 * 1000),
  });
  err.message = `every traffic key is refused or resting (${err.code})`;
  throw err;
}

/** Per-key state for /health: names and reasons only, never values. */
export function trafficKeyStatus(now = Date.now(), env = process.env) {
  return readTrafficKeys(env).map(({ name }) => {
    const rest = resting.get(name);
    return rest && rest.until > now
      ? { name, state: 'resting', reason: rest.reason, resumesAt: new Date(rest.until) }
      : { name, state: 'ready' };
  });
}

/** Test seam. */
export function resetTrafficKeys() {
  resting.clear();
  turn = 0;
}
