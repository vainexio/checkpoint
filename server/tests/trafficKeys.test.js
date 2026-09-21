import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { TomTomError } from '../services/tomtomError.js';
import {
  readTrafficKeys,
  resetTrafficKeys,
  trafficKeyStatus,
  withTrafficKey,
} from '../services/trafficKeys.js';
import {
  demandFromPath,
  noteTrafficDemand,
  refreshGate,
  resetTrafficRefresherState,
  segmentsFor,
  DEMAND_WINDOW_MS,
} from '../services/trafficRefresher.js';

const HOUR = 60 * 60 * 1000;

beforeEach(() => {
  resetTrafficKeys();
  resetTrafficRefresherState();
});

const outOfCredits = () =>
  new TomTomError({ status: 403, code: 'InsufficientFunds', pauseMs: HOUR });

/* ------------------------------------------------------------ reading keys -- */

test('numbered keys are read in number order, gaps and all', () => {
  const keys = readTrafficKeys({
    TRAFFIC_API_KEY2: 'bbb',
    TRAFFIC_API_KEY10: 'ccc',
    TRAFFIC_API_KEY1: 'aaa',
    TRAFFIC_API_KEY4: '   ',
    NOT_A_KEY: 'zzz',
  });
  assert.deepEqual(
    keys.map((k) => k.name),
    ['TRAFFIC_API_KEY1', 'TRAFFIC_API_KEY2', 'TRAFFIC_API_KEY10']
  );
});

test('numbered keys replace the old single key rather than joining it', () => {
  const env = { TRAFFIC_API_KEY: 'old-and-empty', TRAFFIC_API_KEY1: 'aaa' };
  assert.deepEqual(readTrafficKeys(env).map((k) => k.name), ['TRAFFIC_API_KEY1']);

  // With no numbered key the old one still works, so nothing breaks on upgrade.
  assert.deepEqual(readTrafficKeys({ TRAFFIC_API_KEY: 'only' }).map((k) => k.name), [
    'TRAFFIC_API_KEY',
  ]);
});

test('the same key pasted twice counts once', () => {
  const keys = readTrafficKeys({ TRAFFIC_API_KEY1: 'aaa', TRAFFIC_API_KEY2: 'aaa' });
  assert.equal(keys.length, 1);
});

/* ---------------------------------------------------------------- rotation -- */

const TWO = { TRAFFIC_API_KEY1: 'key-one', TRAFFIC_API_KEY2: 'key-two' };

test('requests take the keys in turn, so their allowances are shared', async () => {
  const used = [];
  for (let i = 0; i < 4; i += 1) await withTrafficKey(async (k) => used.push(k), { env: TWO });
  assert.deepEqual(used, ['key-one', 'key-two', 'key-one', 'key-two']);
});

test('adding a third key needs nothing but the variable', async () => {
  const env = { ...TWO, TRAFFIC_API_KEY3: 'key-three' };
  const used = [];
  for (let i = 0; i < 3; i += 1) await withTrafficKey(async (k) => used.push(k), { env });
  assert.deepEqual(used, ['key-one', 'key-two', 'key-three']);
});

test('a key out of credits is stepped past on the same request, then left alone', async () => {
  let t = 1_000_000;
  const now = () => t;
  const tried = [];
  const request = async (key) => {
    tried.push(key);
    if (key === 'key-one') throw outOfCredits();
    return 'answered';
  };

  // The request that finds key one empty is still answered, by key two.
  assert.equal(await withTrafficKey(request, { env: TWO, now }), 'answered');
  assert.deepEqual(tried, ['key-one', 'key-two']);

  // Afterwards key one is not asked again while it rests...
  tried.length = 0;
  await withTrafficKey(request, { env: TWO, now });
  await withTrafficKey(request, { env: TWO, now });
  assert.deepEqual(tried, ['key-two', 'key-two']);

  // ...and is tried again once its rest is over.
  t += HOUR + 1;
  tried.length = 0;
  await withTrafficKey(request, { env: TWO, now });
  await withTrafficKey(request, { env: TWO, now });
  assert.ok(tried.includes('key-one'));
});

test('when every key is refused, the caller is told how long to wait', async () => {
  const t = 5_000_000;
  const request = async () => {
    throw outOfCredits();
  };

  await assert.rejects(withTrafficKey(request, { env: TWO, now: () => t }), (err) => {
    assert.equal(err.code, 'InsufficientFunds');
    assert.equal(err.pauseMs, HOUR);
    assert.doesNotMatch(err.message, /key-one|key-two/);
    return true;
  });
});

test('a failure of one request does not rest the key or spend another', async () => {
  const tried = [];
  const request = async (key) => {
    tried.push(key);
    throw new TomTomError({ status: 504, pauseMs: 0 });
  };

  await assert.rejects(withTrafficKey(request, { env: TWO }), { status: 504 });
  assert.equal(tried.length, 1);
  assert.ok(trafficKeyStatus(Date.now(), TWO).every((k) => k.state === 'ready'));
});

test('status names each key and its state, and never its value', async () => {
  const t = 9_000_000;
  await withTrafficKey(
    async (key) => {
      if (key === 'key-one') throw outOfCredits();
    },
    { env: TWO, now: () => t }
  );

  const status = trafficKeyStatus(t, TWO);
  assert.deepEqual(
    status.map(({ name, state, reason }) => ({ name, state, reason })),
    [
      { name: 'TRAFFIC_API_KEY1', state: 'resting', reason: 'InsufficientFunds' },
      { name: 'TRAFFIC_API_KEY2', state: 'ready', reason: undefined },
    ]
  );
  assert.doesNotMatch(JSON.stringify(status), /key-one|key-two/);
});

/* --------------------------------------------------- only what is watched -- */

const ID = (c) => c.repeat(24);

test('only board and trip pages ask for traffic', () => {
  assert.deepEqual(demandFromPath(`/public/stations/${ID('a')}/board`), { stationId: ID('a') });
  assert.deepEqual(demandFromPath(`/public/trips/${ID('b')}`), { tripId: ID('b') });
  assert.deepEqual(demandFromPath(`/conductor/trips/${ID('c')}`), { tripId: ID('c') });
  assert.deepEqual(demandFromPath(`/admin/trips/${ID('d')}`), { tripId: ID('d') });

  for (const path of ['/public/stations', '/public/map', '/admin/dashboard', '/admin/trips', '/auth/me']) {
    assert.equal(demandFromPath(path), null, path);
  }
});

test('pages that show no traffic never switch lookups on', () => {
  noteTrafficDemand(demandFromPath('/public/map'), 1000);
  assert.deepEqual(refreshGate(1000), { run: false, reason: 'idle' });
});

test('a watched board keeps its lookups going for the window, then lapses', () => {
  noteTrafficDemand({ stationId: ID('a') }, 1000);
  assert.equal(refreshGate(1000).run, true);
  assert.equal(refreshGate(1000 + DEMAND_WINDOW_MS + 1).run, false);
});

/*  A → B → C → D, with the stops named by single letters. */
const plan = ['A', 'B', 'C', 'D'].map((c) => ({
  checkpoint: ID(c.toLowerCase()),
  baselineMinutesFromPrevious: 20,
}));
const trip = (id, at) => ({ _id: ID(id), plan, lastConfirmedCheckpoint: at ? ID(at) : null });

test('a watched station asks only about the leg each bus coming to it is on', () => {
  const segments = segmentsFor([trip('1', 'b')], { stationIds: [ID('d')] });
  assert.deepEqual(
    segments.map((s) => `${s.fromId[0]}->${s.toId[0]}`),
    ['b->c'],
    'the next leg only, not the rest of the route'
  );
});

test('a bus that has already passed the watched station costs nothing', () => {
  assert.deepEqual(segmentsFor([trip('1', 'c')], { stationIds: [ID('b')] }), []);
});

test('buses nobody is looking at cost nothing, and a shared leg is asked once', () => {
  // Watching station C. Trips 1 and 2 are both on B->C, trip 3 is further back
  // on A->B but still coming, and trip 4 is standing at C, already past it for
  // anyone waiting there.
  const trips = [trip('1', 'b'), trip('2', 'b'), trip('3', 'a'), trip('4', 'c')];
  const segments = segmentsFor(trips, { stationIds: [ID('c')] });
  assert.deepEqual(
    segments.map((s) => `${s.fromId[0]}->${s.toId[0]}`),
    ['b->c', 'a->b']
  );

  // Nothing watched, nothing asked.
  assert.deepEqual(segmentsFor(trips, {}), []);
});
