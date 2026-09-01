import { api, setToken } from './client.js';

export async function login(role, username, password) {
  const path = role === 'admin' ? '/auth/admin/login' : '/auth/conductor/login';
  const res = await api.post(path, { username, password });
  setToken(role, res.token);
  return res.user;
}

export const fetchMe = (role) => api.get('/auth/me', { role });
export const logout = (role) => setToken(role, null);
