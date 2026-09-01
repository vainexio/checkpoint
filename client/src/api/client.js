const BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api';

/**
 * Admin and conductor sessions are stored under separate keys and never share a
 * token. They are different products that happen to share a server.
 */
const TOKEN_KEYS = {
  admin: 'checkpoint.admin.token',
  conductor: 'checkpoint.conductor.token',
};

export const getToken = (role) => {
  try {
    return localStorage.getItem(TOKEN_KEYS[role]);
  } catch {
    return null;
  }
};

export const setToken = (role, token) => {
  try {
    if (token) localStorage.setItem(TOKEN_KEYS[role], token);
    else localStorage.removeItem(TOKEN_KEYS[role]);
  } catch {
    /* private browsing — the session just will not persist a reload */
  }
};

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export async function request(path, { method = 'GET', body, role } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const token = role ? getToken(role) : null;
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (res.status === 204) return null;

  const payload = await res.json().catch(() => ({}));

  if (!res.ok) {
    if (res.status === 401 && role) setToken(role, null);
    throw new ApiError(payload.error || `Request failed (${res.status})`, res.status);
  }

  return payload;
}

export const api = {
  get: (path, opts) => request(path, { ...opts, method: 'GET' }),
  post: (path, body, opts) => request(path, { ...opts, method: 'POST', body }),
  put: (path, body, opts) => request(path, { ...opts, method: 'PUT', body }),
  del: (path, opts) => request(path, { ...opts, method: 'DELETE' }),
};
