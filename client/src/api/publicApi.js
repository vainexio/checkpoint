import { api } from './client.js';

// Guest endpoints. Deliberately no role, so no token is ever attached.
export const fetchStations = () => api.get('/public/stations');
export const fetchRoutes = () => api.get('/public/routes');
export const fetchStationBoard = (stationId) => api.get(`/public/stations/${stationId}/board`);
export const fetchActiveTrips = (routeId) =>
  api.get(`/public/trips${routeId ? `?routeId=${routeId}` : ''}`);
export const fetchTrip = (tripId) => api.get(`/public/trips/${tripId}`);
