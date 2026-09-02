import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPlan,
  computeTripState,
  cumulativeBaseline,
  evaluateStaleness,
  resolvePosition,
  addMinutes,
  DELAY_THRESHOLD_MINUTES,
} from '../services/etaEngine.js';

// The Cubao – Baguio demo route from §7. Baselines: 0 / 20 / 80 / 40 / 45.
const CP = {
  cubao: 'cp_cubao',
  balintawak: 'cp_balintawak',
  tarlac: 'cp_tarlac',
  tplex: 'cp_tplex',
  baguio: 'cp_baguio',
};

const plan = [
  { checkpoint: CP.cubao, name: 'Cubao Terminal', type: 'station', baselineMinutesFromPrevious: 0 },
  { checkpoint: CP.balintawak, name: 'Balintawak', type: 'station', baselineMinutesFromPrevious: 20 },
  { checkpoint: CP.tarlac, name: 'Tarlac stop', type: 'station', baselineMinutesFromPrevious: 80 },
  { checkpoint: CP.tplex, name: 'TPLEX – Rosario Exit', type: 'landmark', baselineMinutesFromPrevious: 40 },
  { checkpoint: CP.baguio, name: 'Baguio Terminal', type: 'station', baselineMinutesFromPrevious: 45 },
];

const DEPARTURE = new Date('2026-09-01T06:00:00+08:00');

let logSeq = 0;
const log = (type, minutesAfterDeparture, extra = {}) => {
  logSeq += 1;
  return {
    type,
    reportedAt: addMinutes(DEPARTURE, minutesAfterDeparture),
    clientLogId: `log-${logSeq}`,
    ...extra,
  };
};

const departed = () => log('departed', 0);
const passed = (checkpoint, minutes) => log('passed_checkpoint', minutes, { checkpoint });

const etaFor = (state, checkpointId) =>
  state.computedETAs.find((e) => e.checkpoint === checkpointId).projectedArrival;

const minutesFromDeparture = (date) => (date.getTime() - DEPARTURE.getTime()) / 60000;

test('cumulativeBaseline sums origin-through-index', () => {
  assert.equal(cumulativeBaseline(plan, 0), 0);
  assert.equal(cumulativeBaseline(plan, 1), 20);
  assert.equal(cumulativeBaseline(plan, 2), 100);
  assert.equal(cumulativeBaseline(plan, 4), 185);
});

test('buildPlan forces the origin baseline to zero', () => {
  const route = {
    checkpoints: [
      { checkpoint: { _id: CP.cubao, name: 'Cubao Terminal', type: 'station' }, baselineMinutesFromPrevious: 99 },
      { checkpoint: { _id: CP.balintawak, name: 'Balintawak', type: 'station' }, baselineMinutesFromPrevious: 20 },
    ],
  };
  const built = buildPlan(route);
  assert.equal(built[0].baselineMinutesFromPrevious, 0);
  assert.equal(built[1].baselineMinutesFromPrevious, 20);
});

test('a trip with no logs is scheduled, with no projections', () => {
  const state = computeTripState({ plan, logs: [] });
  assert.equal(state.status, 'scheduled');
  assert.equal(state.actualDeparture, null);
  assert.equal(state.lastConfirmedIndex, -1);
  assert.equal(state.computedETAs.every((e) => e.projectedArrival === null), true);
});

test('on departure every checkpoint is projected at its raw baseline', () => {
  const state = computeTripState({ plan, logs: [departed()] });

  assert.equal(state.status, 'in_transit');
  assert.equal(state.cumulativeVarianceMinutes, 0);
  assert.equal(minutesFromDeparture(etaFor(state, CP.balintawak)), 20);
  assert.equal(minutesFromDeparture(etaFor(state, CP.tarlac)), 100);
  assert.equal(minutesFromDeparture(etaFor(state, CP.baguio)), 185);
  // The origin itself is confirmed the moment the bus leaves.
  assert.equal(state.computedETAs[0].progress, 'passed');
});

test('a late checkpoint pushes every remaining projection by the variance', () => {
  // Balintawak baseline is 20 min; confirmed at 35 min. 15 minutes late.
  const state = computeTripState({ plan, logs: [departed(), passed(CP.balintawak, 35)] });

  assert.equal(state.cumulativeVarianceMinutes, 15);
  assert.equal(state.status, 'delayed');
  assert.equal(state.lastConfirmedCheckpoint, CP.balintawak);
  assert.equal(minutesFromDeparture(etaFor(state, CP.tarlac)), 115); // 100 + 15
  assert.equal(minutesFromDeparture(etaFor(state, CP.tplex)), 155); // 140 + 15
  assert.equal(minutesFromDeparture(etaFor(state, CP.baguio)), 200); // 185 + 15
  // A confirmed checkpoint reports what actually happened, not a projection.
  assert.equal(minutesFromDeparture(etaFor(state, CP.balintawak)), 35);
});

test('running early yields a negative variance and pulls ETAs in', () => {
  const state = computeTripState({ plan, logs: [departed(), passed(CP.balintawak, 12)] });

  assert.equal(state.cumulativeVarianceMinutes, -8);
  assert.equal(state.status, 'in_transit');
  assert.equal(minutesFromDeparture(etaFor(state, CP.baguio)), 177); // 185 - 8
});

test('a small variance stays in_transit rather than flipping to delayed', () => {
  const state = computeTripState({ plan, logs: [departed(), passed(CP.balintawak, 20 + DELAY_THRESHOLD_MINUTES)] });
  assert.equal(state.cumulativeVarianceMinutes, DELAY_THRESHOLD_MINUTES);
  assert.equal(state.status, 'in_transit');
});

test('variance is recomputed from departure, not accumulated per segment', () => {
  // 15 min late at Balintawak, then makes up 10 of it by Tarlac.
  // Cumulative baseline to Tarlac is 100; confirmed at 105 => +5, not +15.
  const state = computeTripState({
    plan,
    logs: [departed(), passed(CP.balintawak, 35), passed(CP.tarlac, 105)],
  });

  assert.equal(state.cumulativeVarianceMinutes, 5);
  assert.equal(minutesFromDeparture(etaFor(state, CP.baguio)), 190);
});

test('a delayed report annotates the trip without moving any ETA', () => {
  const withoutDelay = computeTripState({ plan, logs: [departed(), passed(CP.balintawak, 35)] });
  const withDelay = computeTripState({
    plan,
    logs: [
      departed(),
      passed(CP.balintawak, 35),
      log('delayed', 50, { delayReason: 'traffic' }),
    ],
  });

  assert.equal(withDelay.cumulativeVarianceMinutes, withoutDelay.cumulativeVarianceMinutes);
  assert.deepEqual(
    withDelay.computedETAs.map((e) => e.projectedArrival?.getTime()),
    withoutDelay.computedETAs.map((e) => e.projectedArrival?.getTime())
  );
  assert.equal(withDelay.latestDelay.reason, 'traffic');
  assert.equal(withDelay.latestDelay.nearCheckpoint, 'Balintawak');
});

test('skipping a checkpoint still produces correct variance', () => {
  // Conductor never logs Balintawak, taps Tarlac at 110 min (baseline 100).
  const state = computeTripState({ plan, logs: [departed(), passed(CP.tarlac, 110)] });

  assert.equal(state.cumulativeVarianceMinutes, 10);
  assert.equal(state.computedETAs[1].progress, 'skipped');
  assert.equal(state.computedETAs[2].progress, 'passed');
  assert.equal(minutesFromDeparture(etaFor(state, CP.baguio)), 195);
});

test('logs synced out of order resolve to the same state as in-order logs', () => {
  // This is the offline case: the bus queues several taps through a dead zone
  // and they reach the server in whatever order the connection allows.
  const inOrder = [departed(), passed(CP.balintawak, 35), passed(CP.tarlac, 105), passed(CP.tplex, 150)];
  const scrambled = [inOrder[2], inOrder[0], inOrder[3], inOrder[1]];

  const a = computeTripState({ plan, logs: inOrder });
  const b = computeTripState({ plan, logs: scrambled });

  assert.equal(b.cumulativeVarianceMinutes, a.cumulativeVarianceMinutes);
  assert.equal(b.lastConfirmedCheckpoint, a.lastConfirmedCheckpoint);
  assert.deepEqual(
    b.computedETAs.map((e) => e.projectedArrival?.getTime()),
    a.computedETAs.map((e) => e.projectedArrival?.getTime())
  );
  assert.equal(b.ignoredLogs.length, 0);
});

test('a resubmitted checkpoint is ignored rather than double-counted', () => {
  const first = passed(CP.balintawak, 35);
  const state = computeTripState({ plan, logs: [departed(), first, { ...first }] });

  assert.equal(state.cumulativeVarianceMinutes, 15);
  assert.equal(state.ignoredLogs.length, 1);
  assert.equal(state.ignoredLogs[0].reason, 'checkpoint_already_passed');
});

test('a checkpoint from another route is rejected', () => {
  const state = computeTripState({ plan, logs: [departed(), passed('cp_somewhere_else', 30)] });
  assert.equal(state.ignoredLogs[0].reason, 'checkpoint_not_on_route');
  assert.equal(state.cumulativeVarianceMinutes, 0);
});

test('a checkpoint logged before departure is rejected', () => {
  const state = computeTripState({ plan, logs: [passed(CP.balintawak, 20)] });
  assert.equal(state.status, 'scheduled');
  assert.equal(state.ignoredLogs[0].reason, 'before_departure');
});

test('arrival closes the trip and records the final variance', () => {
  const state = computeTripState({
    plan,
    logs: [departed(), passed(CP.balintawak, 35), log('arrived', 200)],
  });

  assert.equal(state.status, 'arrived');
  assert.equal(minutesFromDeparture(state.actualArrival), 200);
  assert.equal(state.finalVarianceMinutes, 15); // 200 actual vs 185 baseline
  assert.equal(state.computedETAs.at(-1).progress, 'passed');
});

test('passing the final checkpoint counts as arriving', () => {
  const state = computeTripState({ plan, logs: [departed(), passed(CP.baguio, 190)] });
  assert.equal(state.status, 'arrived');
  assert.equal(state.finalVarianceMinutes, 5);
});

test('staleness holds off within the segment grace, then trips', () => {
  const state = computeTripState({ plan, logs: [departed(), passed(CP.balintawak, 20)] });
  // Next segment (Tarlac) is 80 min, so grace runs to 120 min past Balintawak.
  const anchor = addMinutes(DEPARTURE, 20);

  const fresh = evaluateStaleness({ plan, state, now: addMinutes(anchor, 90) });
  assert.equal(fresh.isStale, false);
  assert.equal(fresh.nextCheckpointName, 'Tarlac stop');

  const stale = evaluateStaleness({ plan, state, now: addMinutes(anchor, 121) });
  assert.equal(stale.isStale, true);
  assert.equal(stale.minutesSinceLastConfirm, 121);
});

test('a short segment goes stale sooner than a long one', () => {
  // Balintawak is only 20 min out of Cubao: grace expires at 30 min.
  const justDeparted = computeTripState({ plan, logs: [departed()] });
  assert.equal(
    evaluateStaleness({ plan, state: justDeparted, now: addMinutes(DEPARTURE, 31) }).isStale,
    true
  );
  // At the same 31 minutes into an 80-minute segment, nothing is wrong yet.
  const atBalintawak = computeTripState({ plan, logs: [departed(), passed(CP.balintawak, 20)] });
  assert.equal(
    evaluateStaleness({ plan, state: atBalintawak, now: addMinutes(DEPARTURE, 51) }).isStale,
    false
  );
});

test('scheduled and arrived trips are never stale', () => {
  const scheduled = computeTripState({ plan, logs: [] });
  assert.equal(evaluateStaleness({ plan, state: scheduled, now: new Date('2027-01-01') }).isStale, false);

  const arrived = computeTripState({ plan, logs: [departed(), log('arrived', 200)] });
  assert.equal(evaluateStaleness({ plan, state: arrived, now: new Date('2027-01-01') }).isStale, false);
});

test('a cancelled trip reports cancelled regardless of its logs', () => {
  const state = computeTripState({ plan, logs: [departed(), passed(CP.balintawak, 35)], cancelled: true });
  assert.equal(state.status, 'cancelled');
});

/* ------------------------------------------------------------------ traffic */

const seg = (from, to) => `${from}->${to}`;

test('traffic shifts the road ahead but never rewrites a measured variance', () => {
  // Confirmed Balintawak dead on baseline, then traffic reports +25 on the long
  // Tarlac leg.
  const logs = [departed(), passed(CP.balintawak, 20)];
  const trafficAdjustments = { [seg(CP.balintawak, CP.tarlac)]: 25 };

  const clear = computeTripState({ plan, logs });
  const jammed = computeTripState({ plan, logs, trafficAdjustments });

  // The past is a measurement and must be identical.
  assert.equal(jammed.cumulativeVarianceMinutes, clear.cumulativeVarianceMinutes);
  assert.equal(jammed.cumulativeVarianceMinutes, 0);
  assert.equal(
    etaFor(jammed, CP.balintawak).getTime(),
    etaFor(clear, CP.balintawak).getTime()
  );

  // Everything past the jam moves by it, once — not once per stop.
  assert.equal(minutesFromDeparture(etaFor(jammed, CP.tarlac)), 125);
  assert.equal(minutesFromDeparture(etaFor(jammed, CP.tplex)), 165);
  assert.equal(minutesFromDeparture(etaFor(jammed, CP.baguio)), 210);
});

test('traffic on a segment already driven is ignored', () => {
  // The bus is past Balintawak, so congestion reported on the leg behind it
  // says nothing about when it will reach Baguio.
  const state = computeTripState({
    plan,
    logs: [departed(), passed(CP.balintawak, 20), passed(CP.tarlac, 100)],
    trafficAdjustments: { [seg(CP.cubao, CP.balintawak)]: 40 },
  });

  assert.equal(state.cumulativeVarianceMinutes, 0);
  assert.equal(minutesFromDeparture(etaFor(state, CP.baguio)), 185);
});

test('traffic and running late stack, without double-counting', () => {
  // 15 min late at Balintawak, and 10 min of traffic reported ahead.
  const state = computeTripState({
    plan,
    logs: [departed(), passed(CP.balintawak, 35)],
    trafficAdjustments: { [seg(CP.balintawak, CP.tarlac)]: 10 },
  });

  assert.equal(state.cumulativeVarianceMinutes, 15);
  assert.equal(minutesFromDeparture(etaFor(state, CP.baguio)), 210); // 185 + 15 + 10
});

test('a jam we already know about does not get reported as a missing bus', () => {
  const state = computeTripState({ plan, logs: [departed(), passed(CP.balintawak, 20)] });
  const anchor = addMinutes(DEPARTURE, 20);

  // Tarlac is 80 min out: without traffic the grace window closes at 120 min.
  assert.equal(
    evaluateStaleness({ plan, state, now: addMinutes(anchor, 130) }).isStale,
    true
  );

  // With 45 minutes of reported congestion on that leg, a bus that has not
  // confirmed yet is stuck, not silent.
  const withTraffic = evaluateStaleness({
    plan,
    state,
    now: addMinutes(anchor, 130),
    trafficAdjustments: { [seg(CP.balintawak, CP.tarlac)]: 45 },
  });
  assert.equal(withTraffic.isStale, false);
  assert.equal(withTraffic.nextSegmentTrafficMinutes, 45);
});

test('with no traffic provider the engine behaves exactly as before', () => {
  const a = computeTripState({ plan, logs: [departed(), passed(CP.balintawak, 35)] });
  const b = computeTripState({
    plan,
    logs: [departed(), passed(CP.balintawak, 35)],
    trafficAdjustments: {},
  });
  assert.deepEqual(
    b.computedETAs.map((e) => e.projectedArrival?.getTime()),
    a.computedETAs.map((e) => e.projectedArrival?.getTime())
  );
});

/* --------------------------------------------- at a stop vs on the road */

const left = (checkpoint, minutes) => log('left_checkpoint', minutes, { checkpoint });

test('reaching a station means the bus is at it, not past it', () => {
  const state = computeTripState({ plan, logs: [departed(), passed(CP.balintawak, 20)] });

  // A passenger at Balintawak needs to know the doors may still be open.
  assert.equal(state.position, 'at_stop');
  assert.equal(state.leftLastCheckpointAt, null);
});

test('reporting the pull-out moves the bus onto the road', () => {
  const state = computeTripState({
    plan,
    logs: [departed(), passed(CP.balintawak, 20), left(CP.balintawak, 26)],
  });

  assert.equal(state.position, 'between');
  assert.equal(minutesFromDeparture(state.leftLastCheckpointAt), 26);
  // Still the last confirmed point — leaving does not advance position.
  assert.equal(state.lastConfirmedCheckpoint, CP.balintawak);
});

test('a landmark is never "at" — it is passed and immediately behind', () => {
  // TPLEX is a timing point; a bus does not stand at a toll exit.
  const state = computeTripState({
    plan,
    logs: [departed(), passed(CP.balintawak, 20), passed(CP.tarlac, 100), passed(CP.tplex, 140)],
  });

  assert.equal(state.position, 'between');
});

test('dwelling too long at a stop shows as lateness the moment it is reported', () => {
  // Arrives Balintawak dead on baseline, then sits for 25 minutes.
  const onTime = computeTripState({ plan, logs: [departed(), passed(CP.balintawak, 20)] });
  assert.equal(onTime.cumulativeVarianceMinutes, 0);

  const dwelt = computeTripState({
    plan,
    logs: [departed(), passed(CP.balintawak, 20), left(CP.balintawak, 45)],
  });

  // The overrun is real elapsed time, so it lands immediately rather than
  // waiting to be discovered at the next checkpoint.
  assert.equal(dwelt.cumulativeVarianceMinutes, 25);
  assert.equal(minutesFromDeparture(etaFor(dwelt, CP.baguio)), 210); // 185 + 25
});

test('a bus standing at a stop is not accused of going quiet', () => {
  const state = computeTripState({
    plan,
    logs: [departed(), passed(CP.balintawak, 20), left(CP.balintawak, 100)],
  });

  // Silence is measured from the pull-out, which is the newer report.
  const staleness = evaluateStaleness({ plan, state, now: addMinutes(DEPARTURE, 110) });
  assert.equal(staleness.minutesSinceLastConfirm, 10);
  assert.equal(staleness.isStale, false);
});

test('leaving a checkpoint the bus is not at is rejected', () => {
  const state = computeTripState({
    plan,
    logs: [departed(), passed(CP.balintawak, 20), left(CP.tarlac, 30)],
  });

  assert.equal(state.position, 'at_stop');
  assert.equal(state.ignoredLogs[0].reason, 'not_the_current_checkpoint');
});

test('arriving at the next stop clears the standing state', () => {
  const state = computeTripState({
    plan,
    logs: [
      departed(),
      passed(CP.balintawak, 20),
      left(CP.balintawak, 26),
      passed(CP.tarlac, 100),
    ],
  });

  assert.equal(state.position, 'at_stop');
  assert.equal(state.lastConfirmedCheckpoint, CP.tarlac);
  assert.equal(state.leftLastCheckpointAt, null);
});

/* --------------------------------------------------------- seat availability */

const withLoad = (type, minutes, load, extra = {}) =>
  log(type, minutes, { load, ...extra });

test('load rides along with the tap the conductor was already making', () => {
  const state = computeTripState({
    plan,
    logs: [departed(), withLoad('left_checkpoint', 2, 'few', { checkpoint: CP.cubao })],
  });

  assert.equal(state.load, 'few');
  assert.equal(state.loadReportedAtName, 'Cubao Terminal');
});

test('reaching the next stop invalidates the load rather than carrying it', () => {
  // Leaves Cubao full, then reaches Balintawak where people can get off.
  const state = computeTripState({
    plan,
    logs: [
      departed(),
      withLoad('left_checkpoint', 2, 'full', { checkpoint: CP.cubao }),
      passed(CP.balintawak, 20),
    ],
  });

  // "Full" must not survive the stop where the bus may have emptied.
  assert.equal(state.load, null);
  assert.equal(state.loadReportedAt, null);
});

test('a standalone report updates the load while standing at a stop', () => {
  // The realistic case: packed leaving Cubao, then thirty people alight at
  // Balintawak and the conductor updates before pulling out.
  const state = computeTripState({
    plan,
    logs: [
      departed(),
      withLoad('left_checkpoint', 2, 'full', { checkpoint: CP.cubao }),
      passed(CP.balintawak, 20),
      withLoad('load_report', 23, 'seats'),
    ],
  });

  assert.equal(state.load, 'seats');
  assert.equal(state.loadReportedAtName, 'Balintawak');
  // A load report carries no position information.
  assert.equal(state.position, 'at_stop');
  assert.equal(state.lastConfirmedCheckpoint, CP.balintawak);
});

test('load never touches the arithmetic', () => {
  const plain = computeTripState({ plan, logs: [departed(), passed(CP.balintawak, 35)] });
  const loaded = computeTripState({
    plan,
    logs: [departed(), passed(CP.balintawak, 35), withLoad('load_report', 36, 'full')],
  });

  assert.equal(loaded.cumulativeVarianceMinutes, plain.cumulativeVarianceMinutes);
  assert.deepEqual(
    loaded.computedETAs.map((e) => e.projectedArrival?.getTime()),
    plain.computedETAs.map((e) => e.projectedArrival?.getTime())
  );
});

test('the latest report wins when several arrive out of order', () => {
  const state = computeTripState({
    plan,
    logs: [
      departed(),
      withLoad('load_report', 30, 'seats'),
      withLoad('load_report', 10, 'full'),
    ],
  });

  // Sorted by reportedAt, so the 30-minute reading is the current one.
  assert.equal(state.load, 'seats');
});

/* ------------------------------------------------- traffic-aware delay flag */
// A baseline is one number standing in for a leg that takes 32 minutes at
// midnight and 39 at six in the evening. Judging a bus against it alone means
// flagging every rush-hour trip, so the road it actually had is subtracted out
// before the delay decision.

const passedIn = (checkpoint, minutes, trafficAllowanceMinutes) =>
  log('passed_checkpoint', minutes, { checkpoint, trafficAllowanceMinutes });

test('a bus behind only because the road was slow is not flagged delayed', () => {
  // Balintawak baseline is 20 and the road was running 8 over. Arriving 8 late
  // is exactly keeping up with everyone else on it.
  const state = computeTripState({
    plan,
    logs: [departed(), passedIn(CP.balintawak, 28, 8)],
  });

  assert.equal(state.cumulativeVarianceMinutes, 8, 'still 8 minutes behind the timetable');
  assert.equal(state.conditionsAllowanceMinutes, 8, 'and the road accounts for all 8');
  assert.equal(state.faultVarianceMinutes, 0);
  assert.equal(state.status, 'in_transit');
});

test('delay beyond what the road explains is still flagged', () => {
  // Same slow road, but this bus lost 20 minutes on it.
  const state = computeTripState({
    plan,
    logs: [departed(), passedIn(CP.balintawak, 40, 8)],
  });

  assert.equal(state.cumulativeVarianceMinutes, 20);
  assert.equal(state.conditionsAllowanceMinutes, 8);
  assert.equal(state.faultVarianceMinutes, 12, 'the 12 the road does not explain');
  assert.equal(state.status, 'delayed');
});

test('a quiet road is held against a bus that still lost time', () => {
  // The leg ran 10 under baseline. Being 6 late on an empty road is 16 lost.
  const state = computeTripState({
    plan,
    logs: [departed(), passedIn(CP.balintawak, 26, -10)],
  });

  assert.equal(state.conditionsAllowanceMinutes, -10);
  assert.equal(state.faultVarianceMinutes, 16);
  assert.equal(state.status, 'delayed');
});

test('the ETA follows the timetable variance, never the fault variance', () => {
  // The whole point of separating them: blame changes the badge, not the clock.
  const excused = computeTripState({
    plan,
    logs: [departed(), passedIn(CP.balintawak, 28, 8)],
  });
  const blamed = computeTripState({
    plan,
    logs: [departed(), passed(CP.balintawak, 28)],
  });

  assert.equal(excused.status, 'in_transit');
  assert.equal(blamed.status, 'delayed');
  assert.deepEqual(
    etaFor(excused, CP.baguio),
    etaFor(blamed, CP.baguio),
    'a bus 8 minutes behind arrives 8 minutes late either way'
  );
  assert.equal(minutesFromDeparture(etaFor(excused, CP.baguio)), 185 + 8);
});

test('allowances add up across legs', () => {
  const state = computeTripState({
    plan,
    logs: [departed(), passedIn(CP.balintawak, 26, 6), passedIn(CP.tarlac, 115, 9)],
  });

  assert.equal(state.cumulativeVarianceMinutes, 15, '115 elapsed against a 100 baseline');
  assert.equal(state.conditionsAllowanceMinutes, 15, '6 on the first leg, 9 on the second');
  assert.equal(state.faultVarianceMinutes, 0);
  assert.equal(state.status, 'in_transit');
});

test('a leg with no reading excuses nothing', () => {
  // Offline queue, cold cache, no provider — unknown must never mean forgiven.
  const state = computeTripState({
    plan,
    logs: [departed(), passedIn(CP.balintawak, 26, 6), passed(CP.tarlac, 115)],
  });

  assert.equal(state.conditionsAllowanceMinutes, 6, 'only the leg we actually sampled');
  assert.equal(state.faultVarianceMinutes, 9);
  assert.equal(state.status, 'delayed');
});

test('with no traffic data at all the status is exactly what it always was', () => {
  const late = computeTripState({ plan, logs: [departed(), passed(CP.balintawak, 26)] });
  const early = computeTripState({ plan, logs: [departed(), passed(CP.balintawak, 14)] });

  assert.equal(late.conditionsAllowanceMinutes, 0);
  assert.equal(late.faultVarianceMinutes, late.cumulativeVarianceMinutes);
  assert.equal(late.status, 'delayed');
  assert.equal(early.status, 'in_transit');
});

test('an arrival carries the conditions of the final leg', () => {
  const state = computeTripState({
    plan,
    logs: [
      departed(),
      passed(CP.balintawak, 20),
      passed(CP.tarlac, 100),
      passed(CP.tplex, 140),
      log('arrived', 197, { trafficAllowanceMinutes: 12 }),
    ],
  });

  assert.equal(state.status, 'arrived');
  assert.equal(state.cumulativeVarianceMinutes, 12);
  assert.equal(state.conditionsAllowanceMinutes, 12);
  assert.equal(state.faultVarianceMinutes, 0, 'the whole loss was the road');
});

test('a bad reading cannot excuse a delay past the threshold on the next leg', () => {
  // Replay is a pure function of the logs, so an allowance only ever applies to
  // the leg whose closing tap carried it.
  const state = computeTripState({
    plan,
    logs: [departed(), passedIn(CP.balintawak, 20, 30), passed(CP.tarlac, 130)],
  });

  assert.equal(state.conditionsAllowanceMinutes, 30);
  assert.equal(state.cumulativeVarianceMinutes, 30);
  assert.equal(state.faultVarianceMinutes, 0);
  assert.ok(DELAY_THRESHOLD_MINUTES > 0);
});

test('departing is the pull-out from the origin, not a dwell at it', () => {
  const state = computeTripState({ plan, logs: [departed()] });

  assert.equal(state.position, 'between', 'a departed bus has left');
  assert.deepEqual(state.leftLastCheckpointAt, DEPARTURE);

  // And it stays a confirmed fact rather than decaying into a guess: the
  // conductor said it left, so the board must never hedge that it "assumed" so.
  const later = resolvePosition({ state, now: addMinutes(DEPARTURE, 45) });
  assert.equal(later.position, 'between');
  assert.equal(later.inferred, false);
});

test('reaching a stop still means standing at it until the pull-out', () => {
  // The opposite case, so the fix above cannot quietly disable at-stop entirely.
  const state = computeTripState({ plan, logs: [departed(), passed(CP.balintawak, 20)] });
  assert.equal(state.position, 'at_stop');
  assert.equal(state.leftLastCheckpointAt, null);

  const left = computeTripState({
    plan,
    logs: [departed(), passed(CP.balintawak, 20), log('left_checkpoint', 24, { checkpoint: CP.balintawak })],
  });
  assert.equal(left.position, 'between');
});
