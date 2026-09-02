import mongoose from 'mongoose';

/**
 * A frozen copy of the route's checkpoint sequence, taken when the trip is
 * created. In-flight trips keep the baseline they departed under, so an admin
 * editing a route mid-journey can't retroactively rewrite a running trip's
 * variance — and a finished trip's actual-vs-baseline record stays meaningful
 * as recalibration input later.
 */
const planEntrySchema = new mongoose.Schema(
  {
    checkpoint: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Checkpoint',
      required: true,
    },
    name: { type: String, required: true },
    type: { type: String, enum: ['station', 'landmark'], required: true },
    baselineMinutesFromPrevious: { type: Number, required: true, default: 0 },
  },
  { _id: false }
);

const computedEtaSchema = new mongoose.Schema(
  {
    checkpoint: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Checkpoint',
      required: true,
    },
    // Null until the trip departs: with no actual departure there is nothing to
    // project from, and inventing a time off the schedule would present a guess
    // as a measurement.
    projectedArrival: { type: Date, default: null },
    // "passed" carries a real observation; "skipped" means the conductor
    // confirmed a later point without logging this one.
    progress: {
      type: String,
      enum: ['pending', 'passed', 'skipped'],
      default: 'pending',
    },
    actualArrival: { type: Date, default: null },
  },
  { _id: false }
);

const tripSchema = new mongoose.Schema(
  {
    route: { type: mongoose.Schema.Types.ObjectId, ref: 'Route', required: true },
    bus: { type: mongoose.Schema.Types.ObjectId, ref: 'Bus', required: true },
    conductor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    plan: { type: [planEntrySchema], required: true },

    scheduledDeparture: { type: Date, required: true },
    actualDeparture: { type: Date, default: null },
    actualArrival: { type: Date, default: null },

    status: {
      type: String,
      enum: ['scheduled', 'in_transit', 'delayed', 'arrived', 'cancelled'],
      default: 'scheduled',
    },

    lastConfirmedCheckpoint: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Checkpoint',
      default: null,
    },
    lastConfirmedAt: { type: Date, default: null },

    // Positive = running late, negative = running early. Measured against the
    // timetable, so this is what a passenger feels regardless of the cause.
    cumulativeVarianceMinutes: { type: Number, default: 0 },

    /**
     * How much of that lateness the road itself accounts for, summed from the
     * conditions recorded on each leg as it was driven.
     *
     * Kept apart from the variance rather than folded into it, because the two
     * answer different questions and both get asked: a passenger wants to know
     * how late the bus is, an operator wants to know whether this driver is
     * losing time nobody else on that road lost. Subtract it and you have the
     * second; leave it alone and you still have the first.
     */
    conditionsAllowanceMinutes: { type: Number, default: 0 },

    computedETAs: { type: [computedEtaSchema], default: [] },

    // Recorded once on arrival. Phase 2 baseline recalibration reads this;
    // nothing consumes it yet.
    finalVarianceMinutes: { type: Number, default: null },
  },
  { timestamps: true }
);

// isStale is deliberately NOT a stored field. A trip goes stale by the mere
// passage of time, with no write to trigger an update — persisting it would
// mean serving a "fresh" flag that went wrong minutes ago. It is derived on
// every read instead (see services/etaEngine.js#evaluateStaleness).

tripSchema.index({ status: 1, scheduledDeparture: -1 });
tripSchema.index({ conductor: 1, status: 1 });

export default mongoose.model('Trip', tripSchema);
