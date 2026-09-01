import mongoose from 'mongoose';

/**
 * A known point along a route. Checkpoints are global and reused across routes —
 * "Balintawak" is one document, referenced by every route that passes it.
 * Segment timings live on the Route, not here, because the same point takes a
 * different amount of time to reach depending on where you came from.
 */
const checkpointSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },

    // "station" — passengers can board; gets its own public arrivals board.
    // "landmark" — timing-only point (a toll exit, a junction); no board.
    type: {
      type: String,
      enum: ['station', 'landmark'],
      required: true,
      default: 'station',
    },

    // True for official origin/destination terminals.
    isTerminal: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export default mongoose.model('Checkpoint', checkpointSchema);
