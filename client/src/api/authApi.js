import { api, setToken } from './client.js';

/**
 * One sign-in for admins and conductors alike. The account decides where the
 * person lands; nobody has to pick the right form before typing a password.
 */
export async function login(username, password) {
  const res = await api.post('/auth/login', { username, password });
  setToken(res.token);
  return res.user;
}

/** Whether this deployment still has no accounts at all. */
export const fetchSetupStatus = () => api.get('/auth/setup-status');

/** Claim a brand-new system by creating its first admin. */
export async function createFirstAdmin(body) {
  const res = await api.post('/auth/setup', body);
  setToken(res.token);
  return res.user;
}

export const fetchMe = () => api.get('/auth/me', { auth: true });

/**
 * Replace your own password. The server ends every other session this account
 * had and hands back the one that replaces them.
 */
export async function changePassword(currentPassword, newPassword) {
  const res = await api.post('/auth/password', { currentPassword, newPassword }, { auth: true });
  setToken(res.token);
  return res.user;
}

/** Set a new password with a one-time code an admin issued, and sign in. */
export async function resetPassword({ username, code, newPassword }) {
  const res = await api.post('/auth/reset', { username, code, newPassword });
  setToken(res.token);
  return res.user;
}
export const logout = () => setToken(null);
