import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { TomTomError, pauseFor, tomtomErrorFrom } from '../services/tomtomError.js';
import {
  DEMAND_WINDOW_MS,
  getTrafficStatus,
  noteTrafficDemand,
  refreshGate,
  resetTrafficRefresherState,
  runCycle,
} from '../services/trafficRefresher.js';
import { refreshSegment, setTrafficProvider } from '../services/trafficProvider.js';
import { measureLegs } from '../services/legMeasurer.js';

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;

/* The body TomTom actually returned when the account ran out of credits. */
const OUT_OF_CREDITS = {
  detailedError: {
    code: 'InsufficientFunds',
    message: 'You do not have enough credits to perform this action',
  },
};

const outOfCredits = () =>
  new TomTomError({
    status: 403,
    code: 'InsufficientFunds',
    detail: 'You do not have enough credits to perform this action',
    pauseMs: HOUR,
  });

beforeEach(() => {
  resetTrafficRefresherState();
  setTrafficProvider({ name: 'fake', enabled: true, liveMinutesFor: async () => 10 });
});

/* ------------------------------------------------ classifying failures -- */

test('an account or key refusal pauses lookups for an hour', () => {
  assert.equal(pauseFor({ status: 403, code: 'InsufficientFunds' }), HOUR);
  assert.equal(pauseFor({ status: 401 }), HOUR);
});

test('a rate limit pauses briefly, honouring Retry-After when given', () => {
  assert.equal(pauseFor({ status: 429, retryAfterSeconds: 30 }), 30 * 1000);
  assert.equal(pauseFor({ status: 429 }), MINUTE);
  // TomTom's QPS limit comes back as a 403 whose reason is plain text.
  assert.equal(pauseFor({ status: 403, detail: 'Developer Over Qps' }), MINUTE);
});

test('a failure of one request does not pause anything', () => {
  assert.equal(pauseFor({ status: 500 }), 0);
  assert.equal(pauseFor({ status: 504 }), 0);
  // "rate" inside an unrelated word must not read as a rate limit.
  assert.equal(pauseFor({ status: 400, code: 'InaccurateRoute' }), 0);
});

/* ------------------------------------------------- reading the response -- */

test('the error says why, not just the status', async () => {
  const res = new Response(JSON.stringify(OUT_OF_CREDITS), { status: 403 });
  const err = await tomtomErrorFrom(res);

  assert.equal(
    err.message,
    'TomTom responded 403 InsufficientFunds: You do not have enough credits to perform this action'
  );
  assert.equal(err.status, 403);
  assert.equal(err.code, 'InsufficientFunds');
  assert.equal(err.pauseMs, HOUR);
});

test('a plain-text error body is kept as the reason', async () => {
  const res = new Response('Developer Over Qps', { status: 403 });
  const err = await tomtomErrorFrom(res);

  assert.equal(err.detail, 'Developer Over Qps');
  assert.equal(err.pauseMs, MINUTE);
});

test('Retry-After on a real response is honoured', async () => {
  const res = new Response('{}', { status: 429, headers: { 'Retry-After': '45' } });
  assert.equal((await tomtomErrorFrom(res)).pauseMs, 45 * 1000);
});

test('an error with no body still reports the status', async () => {
  const err = await tomtomErrorFrom(new Response('', { status: 502 }));
  assert.equal(err.message, 'TomTom responded 502');
  assert.equal(err.pauseMs, 0);
});

/* ------------------------------------------------------------- demand ---- */

test('with nobody looking, the refresher does not run', () => {
  assert.deepEqual(refreshGate(1_000_000), { run: false, reason: 'idle' });
});

test('a request keeps lookups on for the demand window, then lets them lapse', () => {
  const t = 5_000_000;
  noteTrafficDemand(t);

  assert.equal(refreshGate(t).run, true);
  assert.equal(refreshGate(t + DEMAND_WINDOW_MS - 1).run, true);
  assert.deepEqual(refreshGate(t + DEMAND_WINDOW_MS + 1), { run: false, reason: 'idle' });
});

test('an idle cycle spends no requests', async () => {
  let calls = 0;
  const result = await runCycle({ now: 1_000_000, refresh: async () => (calls += 1) });

  assert.equal(calls, 0);
  assert.deepEqual(result, { skipped: 'idle' });
});

test('a cycle with demand refreshes once', async () => {
  const t = 2_000_000;
  noteTrafficDemand(t);

  let calls = 0;
  const result = await runCycle({
    now: t,
    refresh: async () => {
      calls += 1;
      return { refreshed: 3, considered: 3 };
    },
  });

  assert.equal(calls, 1);
  assert.deepEqual(result, { refreshed: 3, considered: 3 });
});

test('overlapping cycles join the one already running instead of duplicating it', async () => {
  const t = 3_000_000;
  noteTrafficDemand(t);

  let calls = 0;
  let release;
  const refresh = () => {
    calls += 1;
    return new Promise((resolve) => {
      release = () => resolve({ refreshed: 1, considered: 1 });
    });
  };

  const first = runCycle({ now: t, refresh });
  const second = runCycle({ now: t, refresh });
  release();
  await Promise.all([first, second]);

  assert.equal(calls, 1);
});

/* -------------------------------------------------------------- pausing -- */

test('running out of credits pauses lookups, even while boards are open', async () => {
  const t = 10_000_000;
  noteTrafficDemand(t);

  const result = await runCycle({
    now: t,
    refresh: async () => {
      throw outOfCredits();
    },
  });
  assert.deepEqual(result, { paused: 'InsufficientFunds' });

  // Still in demand a minute later, but nothing is spent.
  noteTrafficDemand(t + MINUTE);
  let calls = 0;
  const later = await runCycle({ now: t + MINUTE, refresh: async () => (calls += 1) });

  assert.equal(calls, 0);
  assert.deepEqual(later, { skipped: 'paused' });
});

test('once the pause is over, it tries the provider again', async () => {
  const t = 20_000_000;
  noteTrafficDemand(t);
  await runCycle({
    now: t,
    refresh: async () => {
      throw outOfCredits();
    },
  });

  const after = t + HOUR + 1;
  noteTrafficDemand(after);
  let calls = 0;
  await runCycle({ now: after, refresh: async () => (calls += 1) });

  assert.equal(calls, 1);
});

test('an ordinary failure does not pause the next cycle', async () => {
  const t = 30_000_000;
  noteTrafficDemand(t);
  await runCycle({
    now: t,
    refresh: async () => {
      throw new Error('socket hang up');
    },
  });

  assert.equal(refreshGate(t).run, true);
});

test('status explains a pause with the provider reason, and nothing else', async () => {
  const t = 40_000_000;
  noteTrafficDemand(t);
  await runCycle({
    now: t,
    refresh: async () => {
      throw outOfCredits();
    },
  });

  const status = getTrafficStatus(t + 1);
  assert.equal(status.state, 'paused');
  assert.equal(status.reason, 'InsufficientFunds');
  assert.equal(status.resumesAt.getTime(), t + HOUR);
});

test('status is disabled when there is no provider', () => {
  setTrafficProvider({ name: 'static', enabled: false, liveMinutesFor: async () => null });
  assert.deepEqual(getTrafficStatus(), { provider: 'static', state: 'disabled' });
});

/* ------------------------------------------------ one segment at a time -- */

const from = { _id: 'a', location: { lat: 14.5, lng: 121.0 } };
const to = { _id: 'b', location: { lat: 14.4, lng: 121.03 } };

test('an account refusal on one segment stops the cycle rather than being swallowed', async () => {
  setTrafficProvider({
    name: 'fake',
    enabled: true,
    liveMinutesFor: async () => {
      throw outOfCredits();
    },
  });

  await assert.rejects(refreshSegment({ from, to, baselineMinutes: 40 }), {
    code: 'InsufficientFunds',
  });
});

test('a one-off lookup failure is still swallowed', async () => {
  setTrafficProvider({
    name: 'fake',
    enabled: true,
    liveMinutesFor: async () => {
      throw new Error('timeout');
    },
  });

  assert.equal(await refreshSegment({ from, to, baselineMinutes: 40 }), null);
});

/* ----------------------------------------------------- measuring a route -- */

const realFetch = globalThis.fetch;
const realKey = process.env.TRAFFIC_API_KEY;

afterEach(() => {
  globalThis.fetch = realFetch;
  if (realKey === undefined) delete process.env.TRAFFIC_API_KEY;
  else process.env.TRAFFIC_API_KEY = realKey;
});

test('measuring a route stops spending requests once the account refuses', async () => {
  process.env.TRAFFIC_API_KEY = 'test-key';
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify(OUT_OF_CREDITS), { status: 403 });
  };

  // Coordinates unique to this test, so nothing comes back from the cache.
  const stops = [
    { id: 's1', name: 'One', type: 'station', location: { lat: 1.1, lng: 2.1 } },
    { id: 's2', name: 'Two', type: 'station', location: { lat: 1.2, lng: 2.2 } },
    { id: 's3', name: 'Three', type: 'station', location: { lat: 1.3, lng: 2.3 } },
    { id: 's4', name: 'Four', type: 'station', location: { lat: 1.4, lng: 2.4 } },
  ];
  const legs = await measureLegs(stops);

  assert.equal(calls, 1, 'one refusal is enough to know the rest will fail');

  const unmeasured = legs.filter((l) => !l.measured);
  assert.equal(unmeasured.length, 3);
  for (const leg of unmeasured) {
    assert.match(leg.reason, /InsufficientFunds/);
    assert.doesNotMatch(leg.reason, /test-key/);
  }
});
