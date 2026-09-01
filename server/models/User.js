import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

/**
 * Admins and conductors share a collection but not an experience — they log in
 * through separate endpoints and land in entirely separate frontends. The role
 * field exists so a token issued for one can never be replayed against the other.
 * Guests have no User document at all; the public board requires no account.
 */
const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    username: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
    },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ['admin', 'conductor'], required: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

userSchema.statics.hashPassword = function hashPassword(plain) {
  return bcrypt.hash(plain, 10);
};

userSchema.methods.verifyPassword = function verifyPassword(plain) {
  return bcrypt.compare(plain, this.passwordHash);
};

userSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.passwordHash;
    return ret;
  },
});

export default mongoose.model('User', userSchema);
