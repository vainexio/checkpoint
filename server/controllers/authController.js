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

/**
 * Whether this deployment still needs its first account.
 *
 * The client asks before showing a login form, because a fresh database has
 * nobody to log in as and a password box would be a dead end.
 */
export const setupStatus = asyncHandler(async (req, res) => {
  const users = await User.estimatedDocumentCount();
  res.json({
    needsSetup: users === 0,
    // A public deployment should set SETUP_TOKEN, so that the window between
    // going live and creating the first account cannot be taken by whoever
    // finds the URL first.
    requiresToken: Boolean(process.env.SETUP_TOKEN),
  });
});

/**
 * Create the very first admin.
 *
 * Self-closing: the moment any user exists this route refuses, so it cannot be
 * used to add a second back door later. Succession is handled by an existing
 * admin creating another (see adminController.createAdmin) — which is also why
 * a single admin account is not a single point of failure.
 */
export const setupFirstAdmin = asyncHandler(async (req, res) => {
  const { name, username, password, token } = req.body;

  const expected = process.env.SETUP_TOKEN;
  if (expected && token !== expected) {
    return res.status(403).json({ error: 'That setup token is not correct.' });
  }

  // Checked immediately before the write; the unique index on username is the
  // real backstop if two requests race.
  if ((await User.estimatedDocumentCount()) > 0) {
    return res.status(409).json({
      error: 'This system already has accounts. Ask an existing admin to create yours.',
    });
  }

  if (!name || !username || !password) {
    return res.status(400).json({ error: 'Name, username and password are all required.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  const admin = await User.create({
    name,
    username,
    role: 'admin',
    passwordHash: await User.hashPassword(password),
  });

  console.log(`[setup] first admin created: ${admin.username}`);

  res.status(201).json({
    token: signToken(admin),
    user: { id: String(admin._id), name: admin.name, username: admin.username, role: admin.role },
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
