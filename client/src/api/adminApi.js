import { api } from './client.js';


const opts = { auth: true };

export const fetchDashboard = () => api.get('/admin/dashboard', opts);

export const listCheckpoints = () => api.get('/admin/checkpoints', opts);
export const createCheckpoint = (body) => api.post('/admin/checkpoints', body, opts);
export const updateCheckpoint = (id, body) => api.put(`/admin/checkpoints/${id}`, body, opts);
export const deleteCheckpoint = (id) => api.del(`/admin/checkpoints/${id}`, opts);

export const listRoutes = () => api.get('/admin/routes', opts);
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
