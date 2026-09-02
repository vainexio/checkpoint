import mongoose from 'mongoose';

/**
 * The raw event stream for a trip. This collection is the source of truth:
 * trip state is a pure replay of these logs in reportedAt order, so a log that
 * arrives late after an offline stretch simply sorts into place and the trip
 * recomputes correctly.
 */
const checkpointLogSchema = new mongoose.Schema(
  {
    trip: { type: mongoose.Schema.Types.ObjectId, ref: 'Trip', required: true },

    // Null for "delayed" reports, which aren't anchored to a point on the route.
    checkpoint: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Checkpoint',
      default: null,
    },

    /**
     * A bus does two separate things at a stop where passengers board: it pulls
     * in, and later it pulls out. Collapsing those into one event makes it
     * impossible to tell a passenger standing there whether to run for the door
     * or give up — so a station gets both, and a landmark, which is genuinely
     * instantaneous, gets only the pass.
     *
     *   departed            — left the origin, trip is under way
     *   passed_checkpoint   — reached this point (a station: now boarding)
     *   left_checkpoint     — pulled out of this point, now on the road again
     *   delayed             — ad-hoc note, changes no arithmetic
     *   arrived             — reached the destination, trip over
     *   load_report         — how full the bus is, reported on its own
     */
    type: {
      type: String,
      enum: [
        'departed',
        'passed_checkpoint',
        'left_checkpoint',
        'delayed',
        'arrived',
        'load_report',
      ],
      required: true,
    },

    /**
     * How full the bus is. Optional on any log, so the usual case costs no
     * extra tap — the conductor picks it as part of leaving a stop.
     *
     *   seats — you will get a seat
     *   few   — you will get on, maybe standing
     *   full  — not picking up; do not wait for this one
     *
     * A judgement, not a measurement: it is what the conductor says, and the
     * board always shows where and when they said it.
     */
    load: {
      type: String,
      enum: ['seats', 'few', 'full', null],
      default: null,
    },

    /**
     * How much slower than its baseline the road the bus had just driven was
     * running, sampled at the moment this tap reached us.
     *
     * Recorded, not derived. Traffic caches expire in minutes, so by the time
     * anyone asks why a bus lost twelve minutes on a leg, the evidence is long
     * gone — the only place that fact can survive is the event that closed the
     * leg. It exists so a delay can be attributed: a bus that lost exactly what
     * the road cost everyone is behind schedule but not at fault.
     *
     * Null means we genuinely do not know — no traffic provider, a cold cache,
     * or a log that sat in an offline queue for an hour. Unknown never excuses
     * anything, so a null simply leaves the delay unexplained.
     */
    trafficAllowanceMinutes: { type: Number, default: null },

    // Only meaningful when type === "delayed".
    delayReason: {
      type: String,
      enum: ['traffic', 'loading', 'breakdown', 'inspection', 'weather', 'other'],
      default: null,
    },

    // Client-generated, set the instant the conductor taps — even with no
    // signal. All ETA math runs off this, never off syncedAt.
    reportedAt: { type: Date, required: true },

    // When the log actually reached the server. Diagnostic only.
    syncedAt: { type: Date, default: Date.now },

    // Idempotency key generated on the device. An offline queue that retries
    // will resubmit; without this a flaky connection double-logs a checkpoint
    // and corrupts the variance.
    clientLogId: { type: String, required: true, unique: true },
  },
  { timestamps: true }
);

checkpointLogSchema.index({ trip: 1, reportedAt: 1 });

export default mongoose.model('CheckpointLog', checkpointLogSchema);
