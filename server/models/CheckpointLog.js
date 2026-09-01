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

    type: {
      type: String,
      enum: ['departed', 'passed_checkpoint', 'delayed', 'arrived'],
      required: true,
    },

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
