import mongoose from 'mongoose';

/**
 * The audit trail for a dispatcher correcting a trip after the fact.
 *
 * A conductor can take back their own tap for five minutes. Past that, the
 * board has been read by passengers and the record has to be put right by
 * someone accountable — so every change an admin makes to a trip's event
 * stream is written here: who, when, what it was before, what it became, and
 * why. The logs themselves stay a clean event stream the engine replays; this
 * is the story of how they came to be that way.
 */
const correctionSchema = new mongoose.Schema(
  {
    trip: { type: mongoose.Schema.Types.ObjectId, ref: 'Trip', required: true, index: true },
    admin: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // Kept as written at the time, so the trail still reads correctly if the
    // account is later renamed or removed.
    adminName: { type: String, required: true },

    action: { type: String, enum: ['added', 'edited', 'deleted'], required: true },

    // Snapshots of the log, not references: a deleted log has nothing left to
    // point at, and an edited one no longer holds its old values.
    before: { type: mongoose.Schema.Types.Mixed, default: null },
    after: { type: mongoose.Schema.Types.Mixed, default: null },

    reason: { type: String, trim: true, maxlength: 300, default: '' },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export default mongoose.model('TripCorrection', correctionSchema);
