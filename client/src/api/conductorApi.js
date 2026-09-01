import { api } from './client.js';

const role = 'conductor';

export const fetchMyTrips = () => api.get('/conductor/trips', { role });
export const fetchMyTrip = (tripId) => api.get(`/conductor/trips/${tripId}`, { role });

/**
 * Drain a queue of taps. Everything goes through the batch endpoint, even a
 * single update — one code path means the offline case is the normal case, not
 * a fallback that only gets exercised when the signal has already gone.
 */
export const syncLogs = (tripId, logs) =>
  api.post(`/conductor/trips/${tripId}/checkpoint-logs/sync`, { logs }, { role });
