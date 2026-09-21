import { randomInt } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { User } from '../models/index.js';
import { signToken } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import {
  checkAttempt,
  recordFailure,
  recordSuccess,
  tooManyAttempts,
} from '../services/loginThrottle.js';

/** What the client is told about the person signed in. */
export const publicUser = (user) => ({
  id: String(user._id),
  name: user.name,
  username: user.username,
  role: user.role,
  // The client sends them to the change-password form first; the server
  // refuses everything else until they have (see middleware/auth.js).
  mustChangePassword: Boolean(user.mustChangePassword),
});

export const MIN_PASSWORD_LENGTH = 8;

/** The rules for any password a person chooses for themselves. */
function passwordProblem(password, { username, current = null } = {}) {
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (username && password.toLowerCase() === String(username).toLowerCase()) {
    return 'Password cannot be the same as the username.';
  }
  if (current && password === current) {
    return 'Choose a password different from the current one.';
  }
  return null;
}

const refuse = (res, retryAfterSeconds) =>
  res.set('Retry-After', String(retryAfterSeconds)).status(429).json({
    error: tooManyAttempts(retryAfterSeconds),
  });

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

  const account = String(username).toLowerCase().trim();
  const attempt = { account, address: req.ip };

  // Checked before the password is even looked at, so a held account costs a
  // guesser nothing but the wait — not one more bcrypt comparison.
  const gate = checkAttempt(attempt);
  if (!gate.allowed) return refuse(res, gate.retryAfterSeconds);

  const user = await User.findOne({ username: account }).select('+passwordHash');

  // One message for both wrong-user and wrong-password, so the form cannot be
  // used to discover which usernames exist. Unknown names count as failures
  // too, for the same reason.
  const invalid = { error: 'Incorrect username or password.' };
  const ok = user?.isActive && (await user.verifyPassword(password));
  if (!ok) {
    recordFailure(attempt);
    return res.status(401).json(invalid);
  }

  recordSuccess(attempt);
  return res.json({ token: signToken(user), user: publicUser(user) });
});

/**
 * Change your own password. The current one is required even though the
 * session is valid: a phone left unlocked on a dashboard should not be enough
 * to take the account over.
 */
export const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body ?? {};
  const user = await User.findById(req.user._id).select('+passwordHash');

  const attempt = { account: `change:${user.username}`, address: req.ip };
  const gate = checkAttempt(attempt);
  if (!gate.allowed) return refuse(res, gate.retryAfterSeconds);

  if (!currentPassword || !(await user.verifyPassword(currentPassword))) {
    recordFailure(attempt);
    return res.status(400).json({ error: 'Your current password is not correct.' });
  }
  recordSuccess(attempt);

  const problem = passwordProblem(newPassword, {
    username: user.username,
    current: currentPassword,
  });
  if (problem) return res.status(400).json({ error: problem });

  await user.setPassword(newPassword);
  await user.save();

  // Every other session this account had is now refused; this is the one new
  // session that replaces them.
  res.json({ token: signToken(user), user: publicUser(user) });
});

/** An unambiguous code alphabet: no 0/O or 1/I to misread off a screen. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const RESET_CODE_MINUTES = 30;

export const normaliseCode = (code) => String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export async function issueResetCode(user) {
  const raw = Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
  user.resetCodeHash = await bcrypt.hash(raw, 10);
  user.resetCodeExpiresAt = new Date(Date.now() + RESET_CODE_MINUTES * 60000);
  await user.save();
  return { code: `${raw.slice(0, 4)}-${raw.slice(4)}`, expiresAt: user.resetCodeExpiresAt };
}

/**
 * Set a new password with a code an admin issued.
 *
 * There is no email or SMS here to send a reset link to, and a conductor locked
 * out at 5 AM in a provincial terminal needs a way back in that does not wait
 * for an admin to type a password for them. So the admin issues a short-lived,
 * single-use code — by phone, in person — and the conductor chooses their own
 * password with it. The admin never learns the new password.
 */
export const resetPassword = asyncHandler(async (req, res) => {
  const { username, code, newPassword } = req.body ?? {};
  if (!username || !code) {
    return res.status(400).json({ error: 'Enter your username and the code you were given.' });
  }

  const account = String(username).toLowerCase().trim();
  const attempt = { account: `reset:${account}`, address: req.ip };
  const gate = checkAttempt(attempt);
  if (!gate.allowed) return refuse(res, gate.retryAfterSeconds);

  const user = await User.findOne({ username: account }).select(
    '+passwordHash +resetCodeHash +resetCodeExpiresAt'
  );

  const valid =
    user?.isActive &&
    user.resetCodeHash &&
    user.resetCodeExpiresAt > new Date() &&
    (await bcrypt.compare(normaliseCode(code), user.resetCodeHash));

  if (!valid) {
    recordFailure(attempt);
    return res.status(400).json({
      error: 'That code is not valid. It may have expired or already been used — ask an admin for a new one.',
    });
  }

  const problem = passwordProblem(newPassword, { username: user.username });
  if (problem) return res.status(400).json({ error: problem });

  recordSuccess(attempt);
  recordSuccess({ account });
  await user.setPassword(newPassword);
  await user.save();

  res.json({ token: signToken(user), user: publicUser(user) });
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

  res.status(201).json({ token: signToken(admin), user: publicUser(admin) });
});

export const me = asyncHandler(async (req, res) => {
  res.json({ user: publicUser(req.user) });
});
