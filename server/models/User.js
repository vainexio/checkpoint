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

    /**
     * Set when someone other than the account holder chose the password — an
     * admin creating the account, or resetting it. The holder has to replace
     * it before they can use anything, so a password that passed through a
     * second pair of hands never stays in use.
     */
    mustChangePassword: { type: Boolean, default: false },

    /**
     * Bumped whenever the password changes, and carried in every session
     * token. A token from before the change carries the old number and is
     * refused, so a reset actually locks out whoever had the old password
     * rather than leaving their session running for the rest of its twelve
     * hours. A counter rather than a timestamp, because a token's issue time
     * is only recorded to the second and one issued in the same second as the
     * change would otherwise slip through.
     */
    tokenVersion: { type: Number, default: 0 },
    passwordChangedAt: { type: Date, default: null },

    // A one-time code an admin issues so a staff member can set a new password
    // themselves. Hashed like a password, and short-lived.
    resetCodeHash: { type: String, default: null, select: false },
    resetCodeExpiresAt: { type: Date, default: null, select: false },
  },
  { timestamps: true }
);

userSchema.statics.hashPassword = function hashPassword(plain) {
  return bcrypt.hash(plain, 10);
};

userSchema.methods.verifyPassword = function verifyPassword(plain) {
  return bcrypt.compare(plain, this.passwordHash);
};

/**
 * Replace the password. Every path that changes one goes through here, so the
 * session cut-off and the reset code are always handled the same way.
 */
userSchema.methods.setPassword = async function setPassword(plain, { mustChange = false } = {}) {
  this.passwordHash = await bcrypt.hash(plain, 10);
  this.passwordChangedAt = new Date();
  this.tokenVersion = (this.tokenVersion ?? 0) + 1;
  this.mustChangePassword = mustChange;
  this.resetCodeHash = null;
  this.resetCodeExpiresAt = null;
};

userSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.passwordHash;
    delete ret.resetCodeHash;
    delete ret.resetCodeExpiresAt;
    return ret;
  },
});

export default mongoose.model('User', userSchema);
