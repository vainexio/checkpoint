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
    { sub: String(user._id), role: user.role, name: user.name },
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

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(payload.sub);
    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'Account is no longer active.' });
    }
    req.user = user;
    return next();
  } catch {
    return res.status(401).json({ error: 'Session expired. Please sign in again.' });
  }
}

export function requireRole(role) {
  return (req, res, next) => {
    if (req.user?.role !== role) {
      return res.status(403).json({ error: 'You do not have access to this area.' });
    }
    return next();
  };
}
