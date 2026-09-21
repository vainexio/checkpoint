import crypto from 'node:crypto';
import { CheckpointLog, Trip, TripCorrection } from '../models/index.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { presentTrip, recomputeTrip, recordLogs, TRIP_POPULATE } from '../services/tripService.js';
import { normaliseLog } from './conductorController.js';

/**
 * A dispatcher putting a trip's record right after the fact.
 *
 * The conductor's undo lasts five minutes, which is the right limit for them —
 * after that passengers have been reading the number. But mistakes found later
 * still have to be fixable without anyone opening the database: a checkpoint
 * tapped at the wrong stop an hour ago, a pull-out logged twice, a departure
 * the conductor forgot to tap at all.
 *
 * Every correction is the same three steps, and that is what makes them safe:
 * change the event stream, replay the whole trip from it, and write down who
 * did it and why. There is no accumulated state to unwind, so a corrected trip
 * lands on exactly the state it would have had if the mistake had never been
 * made.
 */

const CHECKPOINT_TYPES = ['passed_checkpoint', 'left_checkpoint'];

const fail = (status, message) => Object.assign(new Error(message), { status });

/** The parts of a log a person reads, frozen for the audit trail. */
const snapshot = (log) =>
  log && {
    type: log.type,
    checkpoint: log.checkpoint ? String(log.checkpoint) : null,
    reportedAt: log.reportedAt,
    load: log.load ?? null,
    delayReason: log.delayReason ?? null,
    recordedBy: log.recordedBy ?? 'conductor',
  };

async function loadTrip(id) {
  const trip = await Trip.findById(id).select('plan status').lean();
  if (!trip) throw fail(404, 'Trip not found.');
  return trip;
}

/** A checkpoint that is not on this trip's plan would be silently ignored by the engine. */
function assertOnPlan(trip, checkpointId) {
  if (!trip.plan.some((p) => String(p.checkpoint) === String(checkpointId))) {
    throw fail(400, 'That checkpoint is not on this trip.');
  }
}

/** Refuse a time the bus cannot have reported yet — the usual sign of a typo. */
function assertNotFuture(reportedAt) {
  if (new Date(reportedAt).getTime() > Date.now() + 60 * 1000) {
    throw fail(400, 'That time is in the future.');
  }
}

async function audit(req, tripId, action, { before = null, after = null } = {}) {
  await TripCorrection.create({
    trip: tripId,
    admin: req.user._id,
    adminName: req.user.name,
    action,
    before,
    after,
    reason: String(req.body?.reason ?? req.query?.reason ?? '').slice(0, 300),
  });
}

/** The trip as it now replays, with its full log stream and the trail. */
export async function tripRecord(tripId) {
  const trip = await Trip.findById(tripId).populate(TRIP_POPULATE).lean();
  if (!trip) throw fail(404, 'Trip not found.');
  const [logs, corrections] = await Promise.all([
    CheckpointLog.find({ trip: trip._id }).sort({ reportedAt: 1 }).lean(),
    TripCorrection.find({ trip: trip._id }).sort({ createdAt: -1 }).lean(),
  ]);
  return { trip: presentTrip(trip, { logs, audience: 'admin' }), logs, corrections };
}

/**
 * Add an event the conductor never sent — most often a missed tap. The time is
 * required: the whole point is that it happened earlier, and defaulting to now
 * would put it in the wrong place in the replay.
 */
export const addLog = asyncHandler(async (req, res) => {
  const trip = await loadTrip(req.params.id);

  if (!req.body?.reportedAt) throw fail(400, 'Say when this happened.');

  const log = normaliseLog(
    { ...req.body, clientLogId: `admin-${crypto.randomUUID()}` },
    trip._id
  );
  assertNotFuture(log.reportedAt);
  if (CHECKPOINT_TYPES.includes(log.type)) assertOnPlan(trip, log.checkpoint);
  log.recordedBy = 'admin';

  await recordLogs(trip._id, [log]);
  await audit(req, trip._id, 'added', { after: snapshot(log) });

  res.status(201).json(await tripRecord(trip._id));
});

/**
 * Correct an event's time, its checkpoint, or the detail it carried.
 *
 * The type itself is not editable: turning a departure into an arrival is not
 * a correction, it is a different event, and deleting one and adding the other
 * says so honestly in the trail.
 */
export const editLog = asyncHandler(async (req, res) => {
  const trip = await loadTrip(req.params.id);
  const log = await CheckpointLog.findOne({ _id: req.params.logId, trip: trip._id });
  if (!log) throw fail(404, 'That update no longer exists.');

  const before = snapshot(log);
  const changes = {};
  if (req.body.reportedAt !== undefined) changes.reportedAt = req.body.reportedAt;
  if (req.body.checkpoint !== undefined && CHECKPOINT_TYPES.includes(log.type)) {
    changes.checkpoint = req.body.checkpoint;
  }
  if (req.body.load !== undefined) changes.load = req.body.load || null;
  if (req.body.delayReason !== undefined && log.type === 'delayed') {
    changes.delayReason = req.body.delayReason;
  }

  // Validated exactly as a conductor's tap would be.
  const next = normaliseLog(
    {
      type: log.type,
      checkpoint: log.checkpoint,
      reportedAt: log.reportedAt,
      load: log.load,
      delayReason: log.delayReason,
      clientLogId: log.clientLogId,
      ...changes,
    },
    trip._id
  );
  assertNotFuture(next.reportedAt);
  if (CHECKPOINT_TYPES.includes(next.type)) assertOnPlan(trip, next.checkpoint);

  const moved = String(next.checkpoint ?? '') !== String(log.checkpoint ?? '');
  const retimed = next.reportedAt.getTime() !== new Date(log.reportedAt).getTime();
  const reloaded = (next.load ?? null) !== (log.load ?? null);
  const reasoned = next.delayReason !== log.delayReason;
  if (!moved && !retimed && !reloaded && !reasoned) throw fail(400, 'Nothing was changed.');

  log.reportedAt = next.reportedAt;
  log.checkpoint = next.checkpoint;
  log.load = next.load;
  log.delayReason = next.delayReason;
  // The road reading belonged to the leg this tap originally closed. On a
  // different checkpoint it describes the wrong stretch of road, and unknown
  // is the honest value — it excuses nothing.
  if (moved) log.trafficAllowanceMinutes = null;
  await log.save();

  await recomputeTrip(trip._id);
  await audit(req, trip._id, 'edited', { before, after: snapshot(log) });

  res.json(await tripRecord(trip._id));
});

/** Remove an event that should never have been recorded. */
export const deleteLog = asyncHandler(async (req, res) => {
  const trip = await loadTrip(req.params.id);
  const log = await CheckpointLog.findOne({ _id: req.params.logId, trip: trip._id }).lean();
  if (!log) throw fail(404, 'That update no longer exists.');

  await CheckpointLog.deleteOne({ _id: log._id });
  await recomputeTrip(trip._id);
  await audit(req, trip._id, 'deleted', { before: snapshot(log) });

  res.json(await tripRecord(trip._id));
});
