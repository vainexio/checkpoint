import crypto from 'node:crypto';
import { CheckpointLog, Trip } from '../models/index.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import {
  presentTrip,
  presentTrips,
  recomputeTrip,
  recordLogs,
  TRIP_POPULATE,
} from '../services/tripService.js';

/**
 * The conductor's whole world: their own trips, and four taps.
 *
 * Nothing here reads a device location. A conductor confirms a checkpoint the
 * way a courier scans a parcel — by asserting they are at a known point.
 */

const LOG_TYPES = [
  'departed',
  'passed_checkpoint',
  'left_checkpoint',
  'delayed',
  'arrived',
  'load_report',
];
const LOAD_LEVELS = ['seats', 'few', 'full'];
const DELAY_REASONS = ['traffic', 'loading', 'breakdown', 'inspection', 'weather', 'other'];

/** A conductor may only ever touch a trip assigned to them. */
async function loadOwnTrip(req) {
  const trip = await Trip.findOne({
    _id: req.params.tripId,
    conductor: req.user._id,
  }).populate(TRIP_POPULATE);

  if (!trip) {
    throw Object.assign(new Error('That trip is not assigned to you.'), { status: 404 });
  }
  return trip;
}

export const myTrips = asyncHandler(async (req, res) => {
  const trips = await Trip.find({
    conductor: req.user._id,
    status: { $in: ['scheduled', 'in_transit', 'delayed'] },
  })
    .populate(TRIP_POPULATE)
    .sort({ scheduledDeparture: 1 })
    .lean();

  res.json({ trips: await presentTrips(trips, { audience: 'conductor' }) });
});

export const myTrip = asyncHandler(async (req, res) => {
  const trip = await loadOwnTrip(req);
  const logs = await CheckpointLog.find({ trip: trip._id }).sort({ reportedAt: 1 }).lean();
  res.json({ trip: presentTrip(trip.toObject(), { logs, audience: 'conductor' }) });
});

/**
 * Normalise one queued tap into a storable log.
 *
 * `reportedAt` comes from the device, always. It is the moment the conductor
 * tapped, which on a provincial route may be an hour before the phone finds
 * signal again — and it is the only timestamp the ETA engine ever reads.
 */
function normaliseLog(raw, tripId) {
  if (!LOG_TYPES.includes(raw.type)) {
    throw Object.assign(new Error(`Unknown update type: ${raw.type}`), { status: 400 });
  }

  const reportedAt = raw.reportedAt ? new Date(raw.reportedAt) : new Date();
  if (Number.isNaN(reportedAt.getTime())) {
    throw Object.assign(new Error('reportedAt is not a valid timestamp.'), { status: 400 });
  }

  if ((raw.type === 'passed_checkpoint' || raw.type === 'left_checkpoint') && !raw.checkpoint) {
    throw Object.assign(new Error('A checkpoint update must name a checkpoint.'), { status: 400 });
  }

  if (raw.type === 'delayed' && raw.delayReason && !DELAY_REASONS.includes(raw.delayReason)) {
    throw Object.assign(new Error(`Unknown delay reason: ${raw.delayReason}`), { status: 400 });
  }

  if (raw.load && !LOAD_LEVELS.includes(raw.load)) {
    throw Object.assign(new Error(`Unknown seat availability: ${raw.load}`), { status: 400 });
  }

  if (raw.type === 'load_report' && !raw.load) {
    throw Object.assign(new Error('A seat report must say how full the bus is.'), { status: 400 });
  }

  return {
    trip: tripId,
    type: raw.type,
    checkpoint:
      raw.type === 'passed_checkpoint' || raw.type === 'left_checkpoint' ? raw.checkpoint : null,
    delayReason: raw.type === 'delayed' ? (raw.delayReason ?? 'other') : null,
    load: raw.load ?? null,
    reportedAt,
    syncedAt: new Date(),
    // The device should always send one; generating a fallback keeps a manual
    // REST call working without silently disabling replay protection.
    clientLogId: raw.clientLogId || crypto.randomUUID(),
  };
}

/** A single tap, made while the phone happens to have signal. */
export const logUpdate = asyncHandler(async (req, res) => {
  const trip = await loadOwnTrip(req);
  const log = normaliseLog(req.body, trip._id);

  const { trip: updated } = await recordLogs(trip._id, [log]);
  const logs = await CheckpointLog.find({ trip: trip._id }).sort({ reportedAt: 1 }).lean();
  const populated = await Trip.findById(updated._id).populate(TRIP_POPULATE).lean();

  res.status(201).json({
    accepted: 1,
    trip: presentTrip(populated, { logs, audience: 'conductor' }),
  });
});

/**
 * How long a conductor has to take back a tap.
 *
 * Long enough to notice a wrong button on a moving bus, short enough that the
 * board is never rewriting history a passenger already acted on.
 */
const UNDO_WINDOW_MINUTES = 5;

/**
 * Undo a recent update.
 *
 * The whole trip is a replay of its logs, so undoing is genuinely just
 * deleting one and recomputing — there is no accumulated state to unwind and
 * no chance of the trip being left in a half-corrected condition. That is what
 * makes it safe to offer a conductor an undo at all.
 */
export const undoLog = asyncHandler(async (req, res) => {
  const trip = await loadOwnTrip(req);

  const log = await CheckpointLog.findOne({
    trip: trip._id,
    clientLogId: req.params.clientLogId,
  });

  if (!log) return res.status(404).json({ error: 'That update no longer exists.' });

  const ageMinutes = (Date.now() - new Date(log.reportedAt).getTime()) / 60000;
  if (ageMinutes > UNDO_WINDOW_MINUTES) {
    return res.status(409).json({
      error: `Updates can only be undone within ${UNDO_WINDOW_MINUTES} minutes. Ask your dispatcher to correct this one.`,
    });
  }

  await CheckpointLog.deleteOne({ _id: log._id });

  const { trip: updated } = await recomputeTrip(trip._id);
  const logs = await CheckpointLog.find({ trip: trip._id }).sort({ reportedAt: 1 }).lean();
  const populated = await Trip.findById(updated._id).populate(TRIP_POPULATE).lean();

  res.json({ undone: log.type, trip: presentTrip(populated, { logs, audience: 'conductor' }) });
});

/**
 * Drain an offline queue.
 *
 * The client posts everything it buffered while out of signal. Order of
 * arrival is meaningless here — the engine replays the trip's entire history
 * sorted by `reportedAt`, so a batch that arrives scrambled still lands on the
 * same state as if each tap had gone through live.
 */
export const syncQueue = asyncHandler(async (req, res) => {
  const trip = await loadOwnTrip(req);
  const queued = Array.isArray(req.body?.logs) ? req.body.logs : [];

  if (!queued.length) {
    return res.status(400).json({ error: 'No queued updates were included.' });
  }

  const normalised = queued
    .map((raw) => normaliseLog(raw, trip._id))
    .sort((a, b) => a.reportedAt - b.reportedAt);

  const { trip: updated, state } = await recordLogs(trip._id, normalised);
  const logs = await CheckpointLog.find({ trip: trip._id }).sort({ reportedAt: 1 }).lean();
  const populated = await Trip.findById(updated._id).populate(TRIP_POPULATE).lean();

  res.json({
    accepted: normalised.length,
    // Told plainly so the device can clear its queue and, if anything was
    // rejected, show the conductor why instead of retrying forever.
    ignored: state.ignoredLogs,
    syncedClientLogIds: normalised.map((l) => l.clientLogId),
    trip: presentTrip(populated, { logs, audience: 'conductor' }),
  });
});
