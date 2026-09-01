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

    /**
     * Where this point physically is.
     *
     * This is static geocoding of a fixed, known place — a terminal, a toll
     * exit — encoded once by an operator. It is emphatically NOT bus tracking:
     * no vehicle position is ever derived from it. It exists so passengers can
     * see stops on a map and find the ones near them, and so the traffic
     * provider has segment endpoints to ask about.
     */
    location: {
      lat: { type: Number, min: -90, max: 90, default: null },
      lng: { type: Number, min: -180, max: 180, default: null },
    },

    // Free text to orient someone who does not know the area ("Quezon City").
    area: { type: String, trim: true, default: '' },
  },
  { timestamps: true }
);

export default mongoose.model('Checkpoint', checkpointSchema);
