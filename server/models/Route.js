import mongoose from 'mongoose';

const routeCheckpointSchema = new mongoose.Schema(
  {
    checkpoint: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Checkpoint',
      required: true,
    },
    // Fixed baseline travel time from the previous checkpoint in this array.
    // The first entry (the origin) is always 0.
    baselineMinutesFromPrevious: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
  },
  { _id: false }
);

const routeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true }, // "Cubao – Baguio"

    origin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Checkpoint',
      required: true,
    },
    destination: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Checkpoint',
      required: true,
    },

    // Ordered, origin first and destination last.
    checkpoints: {
      type: [routeCheckpointSchema],
      validate: {
        validator: (v) => Array.isArray(v) && v.length >= 2,
        message: 'A route needs at least an origin and a destination.',
      },
    },

    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// origin/destination are stored for convenient population but must never
// disagree with the ordered array — that would quietly break the ETA math.
routeSchema.pre('validate', function normaliseEnds(next) {
  if (this.checkpoints?.length >= 2) {
    this.checkpoints[0].baselineMinutesFromPrevious = 0;
    this.origin = this.checkpoints[0].checkpoint;
    this.destination = this.checkpoints[this.checkpoints.length - 1].checkpoint;
  }
  next();
});

export default mongoose.model('Route', routeSchema);
