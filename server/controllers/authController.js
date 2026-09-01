import { User } from '../models/index.js';
import { signToken } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';

/**
 * One sign-in for staff.
 *
 * Admins and conductors share a single login: nobody should have to know which
 * of two forms is "theirs" before they can type a password. The account decides
 * what happens next — the token carries the role, and the app sends the person
 * to the product that role belongs to.
 *
 * The role boundary is enforced where it actually matters, on every protected
 * route (see middleware/auth.js). Guests never come through here at all; the
 * public board has no account.
 */
export const login = asyncHandler(async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  const user = await User.findOne({
    username: String(username).toLowerCase().trim(),
  }).select('+passwordHash');

  // One message for both wrong-user and wrong-password, so the form cannot be
  // used to discover which usernames exist.
  const invalid = { error: 'Incorrect username or password.' };
  if (!user || !user.isActive) return res.status(401).json(invalid);

  const ok = await user.verifyPassword(password);
  if (!ok) return res.status(401).json(invalid);

  return res.json({
    token: signToken(user),
    user: { id: String(user._id), name: user.name, username: user.username, role: user.role },
  });
});

export const me = asyncHandler(async (req, res) => {
  res.json({
    user: {
      id: String(req.user._id),
      name: req.user.name,
      username: req.user.username,
      role: req.user.role,
    },
  });
});
