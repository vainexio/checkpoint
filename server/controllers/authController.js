import { User } from '../models/index.js';
import { signToken } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';

/**
 * Admins and conductors sign in through separate endpoints. Same credentials
 * table, different doors — a conductor typing their password into the admin
 * form gets turned away rather than landing somewhere they cannot use.
 */
const loginAs = (role) =>
  asyncHandler(async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }

    const user = await User.findOne({
      username: String(username).toLowerCase().trim(),
      role,
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

export const loginAdmin = loginAs('admin');
export const loginConductor = loginAs('conductor');

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
