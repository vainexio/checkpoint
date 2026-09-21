import jwt from 'jsonwebtoken';
import { User } from '../models/index.js';

/**
 * Admin and conductor tokens are the same format but carry a role, and every
 * protected route asserts the role it expects. A conductor token is never a
 * weaker admin token — it simply cannot reach admin routes.
 *
 * Guest routes never touch this file. The public arrivals board is
 * unauthenticated by design; there is no account to make.
 */

export function signToken(user) {
  return jwt.sign(
    { sub: String(user._id), role: user.role, name: user.name, ver: user.tokenVersion ?? 0 },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '12h' }
  );
}

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Session expired. Please sign in again.' });
  }

  const user = await User.findById(payload.sub);
  if (!user || !user.isActive) {
    return res.status(401).json({ error: 'Account is no longer active.' });
  }

  // A session from before the password last changed belongs to whoever knew
  // the old one. Tokens issued before versions existed carry none, which
  // reads as the starting version, so nobody was signed out by the upgrade.
  if ((payload.ver ?? 0) !== (user.tokenVersion ?? 0)) {
    return res.status(401).json({ error: 'Your password was changed. Please sign in again.' });
  }

  req.user = user;
  return next();
}

export function requireRole(role) {
  return (req, res, next) => {
    if (req.user?.role !== role) {
      return res.status(403).json({ error: 'You do not have access to this area.' });
    }
    // Enforced here rather than trusted to the client: a password someone
    // else chose opens nothing but the form that replaces it.
    if (req.user.mustChangePassword) {
      return res.status(403).json({
        error: 'Choose a new password before continuing.',
        code: 'PASSWORD_CHANGE_REQUIRED',
      });
    }
    return next();
  };
}
