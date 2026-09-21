import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addMinutes,
  bandAt,
  buildPlan,
  computeTripState,
  selectBaselines,
} from '../services/etaEngine.js';
import { measureLegs, nextWeekdayAt } from '../services/legMeasurer.js';

const manila = (hhmm, day = '2026-09-22') => new Date(`${day}T${hhmm}:00+08:00`);

/* --------------------------------------------------------------- the bands -- */

test('the peaks are the MMDA number-coding hours, on the Manila clock', () => {
  assert.equal(bandAt(manila('06:59')), 'offPeak');
  assert.equal(bandAt(manila('07:00')), 'amPeak');
  assert.equal(bandAt(manila('09:59')), 'amPeak');
  assert.equal(bandAt(manila('10:00')), 'offPeak');
  assert.equal(bandAt(manila('16:59')), 'offPeak');
  assert.equal(bandAt(manila('17:00')), 'pmPeak');
  assert.equal(bandAt(manila('19:59')), 'pmPeak');
  assert.equal(bandAt(manila('20:00')), 'offPeak');
  assert.equal(bandAt(manila('00:30')), 'offPeak');
});

/* Alabang → Turbina is the leg whose spread started all this: 32 minutes at
   midnight, 39 at six in the evening. */
const route = {
  checkpoints: [
    { checkpoint: { _id: 'pitx', name: 'PITX', type: 'station' }, baselineMinutesFromPrevious: 0 },
    {
      checkpoint: { _id: 'alabang', name: 'Alabang', type: 'station' },
      baselineMinutesFromPrevious: 40,
      amPeakMinutes: 55,
      pmPeakMinutes: 58,
    },
    {
      checkpoint: { _id: 'turbina', name: 'Turbina', type: 'station' },
      baselineMinutesFromPrevious: 32,
      pmPeakMinutes: 39,
    },
    { checkpoint: { _id: 'lipa', name: 'Lipa', type: 'station' }, baselineMinutesFromPrevious: 60 },
  ],
};

const minutesOf = (plan) => plan.map((p) => p.baselineMinutesFromPrevious);
const bandsOf = (plan) => plan.map((p) => p.baselineBand);

test('a route with one number per leg plans exactly as it always did', () => {
  const single = {
    checkpoints: route.checkpoints.map(({ checkpoint, baselineMinutesFromPrevious }) => ({
      checkpoint,
      baselineMinutesFromPrevious,
    })),
  };
  for (const at of [manila('08:00'), manila('18:00'), manila('02:00'), null]) {
    const plan = buildPlan(single, { departure: at });
    assert.deepEqual(minutesOf(plan), [0, 40, 32, 60]);
    assert.ok(bandsOf(plan).every((b) => b === 'offPeak'));
  }
});

test('an off-peak departure uses the off-peak figures', () => {
  const plan = buildPlan(route, { departure: manila('11:00') });
  assert.deepEqual(minutesOf(plan), [0, 40, 32, 60]);
});

test('each leg is judged by when the bus is due to start it, not by the departure', () => {
  // Leaves at 16:40, off-peak. The first leg ends at 17:20, so the second leg
  // starts in the evening rush and takes its rush-hour figure.
  const plan = buildPlan(route, { departure: manila('16:40') });
  assert.deepEqual(minutesOf(plan), [0, 40, 39, 60]);
  assert.deepEqual(bandsOf(plan), ['offPeak', 'offPeak', 'pmPeak', 'offPeak']);
});

test('a peak with no figure for a leg falls back to its off-peak baseline', () => {
  // 07:30: the first leg has a morning figure; the second does not.
  const plan = buildPlan(route, { departure: manila('07:30') });
  assert.deepEqual(minutesOf(plan), [0, 55, 32, 60]);
  assert.deepEqual(bandsOf(plan), ['offPeak', 'amPeak', 'offPeak', 'offPeak']);
});

test('a trip moved to another hour re-chooses from its own frozen figures', () => {
  const morning = buildPlan(route, { departure: manila('11:00') });
  const evening = selectBaselines(morning, manila('17:30'));
  assert.deepEqual(minutesOf(evening), [0, 58, 39, 60]);
  // And back again, without the route.
  assert.deepEqual(minutesOf(selectBaselines(evening, manila('11:00'))), [0, 40, 32, 60]);
});

test('a rush-hour trip running normally is no longer reported late', () => {
  const departure = manila('17:30');
  // The bus drives the evening road exactly as the evening road usually goes.
  const logs = [
    { type: 'departed', reportedAt: departure, clientLogId: 'd' },
    { type: 'passed_checkpoint', checkpoint: 'alabang', reportedAt: addMinutes(departure, 58), clientLogId: 'a' },
    { type: 'passed_checkpoint', checkpoint: 'turbina', reportedAt: addMinutes(departure, 97), clientLogId: 't' },
  ];

  const banded = computeTripState({ plan: buildPlan(route, { departure }), logs });
  assert.equal(banded.cumulativeVarianceMinutes, 0);
  assert.equal(banded.status, 'in_transit');

  // Judged by the single off-peak number, the same drive is 25 minutes "late".
  const offPeakOnly = computeTripState({ plan: buildPlan(route), logs });
  assert.equal(offPeakOnly.cumulativeVarianceMinutes, 25);
  assert.equal(offPeakOnly.status, 'delayed');
});

/* ---------------------------------------------------------- measuring bands -- */

test('peaks are measured on a weekday, at a fixed hour, in the future', () => {
  // Saturday 26 September, late evening: the next weekday is Monday.
  const at = nextWeekdayAt('08:30', manila('22:00', '2026-09-26'));
  assert.equal(at.toISOString(), '2026-09-28T00:30:00.000Z');
  assert.ok(at > manila('22:00', '2026-09-26'));
});

test('measuring with bands asks for each peak, and never sends the key anywhere else', async () => {
  const realFetch = globalThis.fetch;
  const realKey = process.env.TRAFFIC_API_KEY;
  process.env.TRAFFIC_API_KEY = 'test-key';

  const asked = [];
  globalThis.fetch = async (url) => {
    const departAt = new URL(url).searchParams.get('departAt');
    asked.push(departAt);
    const hour = new Date(departAt).getUTCHours() + 8;
    // 30 minutes off-peak, 45 in the morning rush, 50 in the evening.
    const minutes = hour === 11 ? 30 : hour === 8 ? 45 : 50;
    return new Response(
      JSON.stringify({ routes: [{ summary: { historicTrafficTravelTimeInSeconds: minutes * 60, lengthInMeters: 20000 } }] }),
      { status: 200 }
    );
  };

  try {
    const legs = await measureLegs(
      [
        { id: 'a', name: 'A', type: 'station', location: { lat: 3.1, lng: 4.1 } },
        { id: 'b', name: 'B', type: 'landmark', location: { lat: 3.2, lng: 4.2 } },
      ],
      { bands: true }
    );

    assert.equal(asked.length, 3, 'one request per band');
    assert.ok(asked.every(Boolean), 'every request names the hour it is asking about');
    assert.equal(legs[1].baselineMinutes, 30);
    assert.equal(legs[1].amPeakMinutes, 45);
    assert.equal(legs[1].pmPeakMinutes, 50);
  } finally {
    globalThis.fetch = realFetch;
    if (realKey === undefined) delete process.env.TRAFFIC_API_KEY;
    else process.env.TRAFFIC_API_KEY = realKey;
  }
});
