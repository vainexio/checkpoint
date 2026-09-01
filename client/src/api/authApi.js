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

export const fetchMe = () => api.get('/auth/me', { auth: true });
export const logout = () => setToken(null);
