import mongoose from 'mongoose';

const busSchema = new mongoose.Schema(
  {
    plateNumber: { type: String, required: true, trim: true, unique: true, uppercase: true },
    // Phase 1 is single-operator; this is a label, not a tenant boundary.
    operatorName: { type: String, required: true, trim: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.model('Bus', busSchema);
