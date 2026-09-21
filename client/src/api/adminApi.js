import { api, request } from './client.js';


const opts = { auth: true };

export const fetchDashboard = () => api.get('/admin/dashboard', opts);

/** Rebuild the seeded demo data. Admin only, enforced on the server. */
export const reseedDemoData = () => api.post('/admin/reseed', {}, opts);

/** How the rebuild started above is getting on. */
export const reseedProgress = () => api.get('/admin/reseed', opts);

/** Free OpenStreetMap place lookup, proxied and rate-limited by our server. */
export const geocodePlace = (q) =>
  api.get(`/admin/geocode?q=${encodeURIComponent(q)}`, opts);

export const listCheckpoints = () => api.get('/admin/checkpoints', opts);
export const createCheckpoint = (body) => api.post('/admin/checkpoints', body, opts);
export const updateCheckpoint = (id, body) => api.put(`/admin/checkpoints/${id}`, body, opts);
export const deleteCheckpoint = (id) => api.del(`/admin/checkpoints/${id}`, opts);

export const listRoutes = () => api.get('/admin/routes', opts);
/** Ask TomTom how long each leg of a route being drawn normally takes. */
export const measureRouteLegs = (checkpointIds) =>
  api.post('/admin/routes/measure', { checkpointIds }, opts);

export const createRoute = (body) => api.post('/admin/routes', body, opts);
export const updateRoute = (id, body) => api.put(`/admin/routes/${id}`, body, opts);
export const deleteRoute = (id) => api.del(`/admin/routes/${id}`, opts);

export const listBuses = () => api.get('/admin/buses', opts);
export const createBus = (body) => api.post('/admin/buses', body, opts);
export const deleteBus = (id) => api.del(`/admin/buses/${id}`, opts);

export const listConductors = () => api.get('/admin/conductors', opts);
export const createConductor = (body) => api.post('/admin/conductors', body, opts);
export const deleteConductor = (id) => api.del(`/admin/conductors/${id}`, opts);

export const listTrips = (query = '') => api.get(`/admin/trips${query}`, opts);
export const createTrip = (body) => api.post('/admin/trips', body, opts);
export const updateTrip = (id, body) => api.put(`/admin/trips/${id}`, body, opts);
export const deleteTrip = (id) => api.del(`/admin/trips/${id}`, opts);

/** One trip with its full log stream and correction trail. */
export const fetchTripRecord = (id) => api.get(`/admin/trips/${id}`, opts);
/** Dispatcher corrections: each replays the trip and is written to its trail. */
export const addTripLog = (id, body) => api.post(`/admin/trips/${id}/logs`, body, opts);
export const editTripLog = (id, logId, body) =>
  api.put(`/admin/trips/${id}/logs/${logId}`, body, opts);
export const deleteTripLog = (id, logId, reason = '') =>
  request(`/admin/trips/${id}/logs/${logId}`, { ...opts, method: 'DELETE', body: { reason } });

/** Recurring departures. The server generates a week of trips from each. */
export const listSchedules = () => api.get('/admin/schedules', opts);
export const createSchedule = (body) => api.post('/admin/schedules', body, opts);
export const updateSchedule = (id, body) => api.put(`/admin/schedules/${id}`, body, opts);
export const deleteSchedule = (id) => api.del(`/admin/schedules/${id}`, opts);
