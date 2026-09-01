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
export const logout = () => setToken(null);
