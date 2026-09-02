import test from 'node:test';
import assert from 'node:assert/strict';

import { applyTap } from '../src/utils/optimisticTrip.js';

/**
 * The optimistic update has to land on the same state the server will send a
 * second later, or the screen visibly jumps and the conductor stops trusting it.
 * These pin the parts that decide what the next tap button says.
 */

const stop = (id, name, type = 'station') => ({
  checkpointId: id,
  name,
  type,
  progress: 'pending',
  actualArrival: null,
  projectedArrival: '2026-09-02T10:00:00.000Z',
});

const baseTrip = () => ({
  status: 'scheduled',
  position: 'between',
  actualDeparture: null,
  lastConfirmedCheckpoint: null,
  lastConfirmedAt: null,
  leftLastCheckpointAt: null,
  nextCheckpoint: null,
  load: null,
  stops: [
    stop('a', 'Cubao'),
    stop('b', 'Balintawak'),
    stop('c', 'TPLEX Exit', 'landmark'),
    stop('d', 'Baguio'),
  ],
});

const AT = '2026-09-02T06:00:00.000Z';

test('departing marks the origin passed and points at the next stop', () => {
  const t = applyTap(baseTrip(), { type: 'departed' }, AT);

  assert.equal(t.status, 'in_transit');
  assert.equal(t.actualDeparture, AT);
  assert.equal(t.stops[0].progress, 'passed');
  assert.equal(t.nextCheckpoint.name, 'Balintawak');
  // Departing is the pull-out from the origin, matching the server engine.
  assert.equal(t.position, 'between');
  assert.equal(t.leftLastCheckpointAt, AT);
});

test('reaching a station leaves the bus standing at it', () => {
  const t = applyTap(baseTrip(), { type: 'passed_checkpoint', checkpoint: 'b' }, AT);

  assert.equal(t.stops[1].progress, 'passed');
  assert.equal(t.position, 'at_stop', 'doors may still be open');
  assert.equal(t.lastConfirmedCheckpoint.name, 'Balintawak');
  assert.equal(t.nextCheckpoint.name, 'TPLEX Exit');
  assert.equal(t.leftLastCheckpointAt, null);
});

test('a landmark is passed, never stood at', () => {
  const t = applyTap(baseTrip(), { type: 'passed_checkpoint', checkpoint: 'c' }, AT);
  assert.equal(t.position, 'between', 'nobody boards at a timing point');
});

test('tapping a later stop marks the skipped ones as skipped, not pending', () => {
  const t = applyTap(baseTrip(), { type: 'passed_checkpoint', checkpoint: 'c' }, AT);
  assert.equal(t.stops[0].progress, 'skipped');
  assert.equal(t.stops[1].progress, 'skipped');
  assert.equal(t.stops[2].progress, 'passed');
});

test('reaching the final stop ends the trip', () => {
  const t = applyTap(baseTrip(), { type: 'passed_checkpoint', checkpoint: 'd' }, AT);
  assert.equal(t.status, 'arrived');
  assert.equal(t.position, 'arrived');
  assert.equal(t.actualArrival, AT);
});

test('pulling out puts the bus back on the road', () => {
  const atStop = applyTap(baseTrip(), { type: 'passed_checkpoint', checkpoint: 'b' }, AT);
  const left = applyTap(atStop, { type: 'left_checkpoint', checkpoint: 'b' }, AT);
  assert.equal(left.position, 'between');
  assert.equal(left.leftLastCheckpointAt, AT);
});

test('reaching a stop clears the load reported for the last leg', () => {
  const withLoad = applyTap(baseTrip(), { type: 'load_report', load: 'full' }, AT);
  assert.equal(withLoad.load, 'full');

  // People board and alight here, so "full" must not survive the stop.
  const moved = applyTap(withLoad, { type: 'passed_checkpoint', checkpoint: 'b' }, AT);
  assert.equal(moved.load, null);
});

test('a load reported with the tap is kept and attributed to that stop', () => {
  const t = applyTap(baseTrip(), { type: 'passed_checkpoint', checkpoint: 'b', load: 'seats' }, AT);
  assert.equal(t.load, 'seats');
  assert.equal(t.loadReportedAtName, 'Balintawak');
});

test('a delay report changes no position and moves nothing', () => {
  const before = applyTap(baseTrip(), { type: 'departed' }, AT);
  const after = applyTap(before, { type: 'delayed', delayReason: 'traffic' }, AT);

  assert.equal(after.latestDelay.reason, 'traffic');
  assert.equal(after.position, before.position);
  assert.equal(after.nextCheckpoint.name, before.nextCheckpoint.name);
  assert.deepEqual(
    after.stops.map((s) => s.progress),
    before.stops.map((s) => s.progress)
  );
});

test('arrival times are never invented locally', () => {
  const t = applyTap(baseTrip(), { type: 'passed_checkpoint', checkpoint: 'b' }, AT);
  // The engine owns projections; guessing here would put two answers on screen
  // a second apart.
  assert.equal(t.stops[3].projectedArrival, '2026-09-02T10:00:00.000Z');
  assert.equal(t.isProvisional, true, 'and the screen must say the times are not fresh');
});

test('the trip on screen is not mutated in place', () => {
  const original = baseTrip();
  const snapshot = JSON.stringify(original);
  applyTap(original, { type: 'passed_checkpoint', checkpoint: 'b' }, AT);
  assert.equal(JSON.stringify(original), snapshot, 'React needs a new object to re-render');
});

test('an unknown tap type leaves the trip exactly as it was', () => {
  const original = baseTrip();
  assert.equal(applyTap(original, { type: 'nonsense' }, AT), original);
});
