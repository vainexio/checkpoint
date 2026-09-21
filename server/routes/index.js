import { Router } from 'express';

import * as auth from '../controllers/authController.js';
import * as admin from '../controllers/adminController.js';
import * as conductor from '../controllers/conductorController.js';
import * as pub from '../controllers/publicController.js';
import * as correction from '../controllers/correctionController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

/* ------------------------------------------------------------------ auth */
// One door for staff. The account's role decides which product they land in;
// the role boundary itself is enforced per-route below.
// Open only while the system has no accounts at all; refuses forever after.
router.get('/auth/setup-status', auth.setupStatus);
router.post('/auth/setup', auth.setupFirstAdmin);

router.post('/auth/login', auth.login);
router.get('/auth/me', requireAuth, auth.me);
// Deliberately requireAuth alone: someone who must change a temporary password
// has to be able to reach the one route that lets them.
router.post('/auth/password', requireAuth, auth.changePassword);
// With a one-time code an admin issued. No session, by definition.
router.post('/auth/reset', auth.resetPassword);

/* ---------------------------------------------------------------- public */
// No auth middleware below this line, on purpose. A passenger checking a bus
// should never meet a login screen.
router.get('/public/stations', pub.listStations);
router.get('/public/stations/nearby', pub.nearbyStations);
router.get('/public/map', pub.mapData);
router.get('/public/stations/:stationId/board', pub.stationBoard);
// Destination-first: "which bus near me is going to Lipa".
router.get('/public/journeys', pub.searchJourneys);
router.get('/public/routes', pub.listRoutes);
router.get('/public/trips', pub.listActiveTrips);
router.get('/public/trips/:tripId', pub.tripDetail);

/* ------------------------------------------------------------- conductor */
const conductorOnly = [requireAuth, requireRole('conductor')];

router.get('/conductor/trips', ...conductorOnly, conductor.myTrips);
router.get('/conductor/trips/:tripId', ...conductorOnly, conductor.myTrip);
router.post('/conductor/trips/:tripId/checkpoint-logs', ...conductorOnly, conductor.logUpdate);
router.post('/conductor/trips/:tripId/checkpoint-logs/sync', ...conductorOnly, conductor.syncQueue);
router.delete(
  '/conductor/trips/:tripId/checkpoint-logs/:clientLogId',
  ...conductorOnly,
  conductor.undoLog
);

/* ----------------------------------------------------------------- admin */
const adminOnly = [requireAuth, requireRole('admin')];

router.get('/admin/dashboard', ...adminOnly, admin.dashboard);

router.get('/admin/geocode', ...adminOnly, admin.geocodePlace);

router.get('/admin/checkpoints', ...adminOnly, admin.listCheckpoints);
router.post('/admin/checkpoints', ...adminOnly, admin.createCheckpoint);
router.put('/admin/checkpoints/:id', ...adminOnly, admin.updateCheckpoint);
router.delete('/admin/checkpoints/:id', ...adminOnly, admin.deleteCheckpoint);

router.post('/admin/routes/measure', ...adminOnly, admin.measureRouteLegs);

router.get('/admin/routes', ...adminOnly, admin.listRoutes);
router.get('/admin/routes/:id', ...adminOnly, admin.getRoute);
router.post('/admin/routes', ...adminOnly, admin.createRoute);
router.put('/admin/routes/:id', ...adminOnly, admin.updateRoute);
router.delete('/admin/routes/:id', ...adminOnly, admin.deleteRoute);

router.get('/admin/buses', ...adminOnly, admin.listBuses);
router.post('/admin/buses', ...adminOnly, admin.createBus);
router.put('/admin/buses/:id', ...adminOnly, admin.updateBus);
router.delete('/admin/buses/:id', ...adminOnly, admin.deleteBus);

router.get('/admin/admins', ...adminOnly, admin.listAdmins);
router.post('/admin/admins', ...adminOnly, admin.createAdmin);
router.delete('/admin/admins/:id', ...adminOnly, admin.deleteAdmin);

router.get('/admin/conductors', ...adminOnly, admin.listConductors);
router.post('/admin/conductors', ...adminOnly, admin.createConductor);
router.put('/admin/conductors/:id', ...adminOnly, admin.updateConductor);
router.delete('/admin/conductors/:id', ...adminOnly, admin.deleteConductor);

// Any staff account, admin or conductor.
router.post('/admin/users/:id/reset-code', ...adminOnly, admin.createResetCode);

router.get('/admin/trips', ...adminOnly, admin.listTrips);
router.get('/admin/trips/:id', ...adminOnly, admin.getTrip);
router.post('/admin/trips', ...adminOnly, admin.createTrip);
router.put('/admin/trips/:id', ...adminOnly, admin.updateTrip);
router.delete('/admin/trips/:id', ...adminOnly, admin.deleteTrip);

// Putting a trip's record right after the conductor's undo window has closed.
// Every change replays the trip and is written to its audit trail.
router.post('/admin/trips/:id/logs', ...adminOnly, correction.addLog);
router.put('/admin/trips/:id/logs/:logId', ...adminOnly, correction.editLog);
router.delete('/admin/trips/:id/logs/:logId', ...adminOnly, correction.deleteLog);

// Recurring departures. Trips are generated from these for a rolling window.
router.get('/admin/schedules', ...adminOnly, admin.listSchedules);
router.post('/admin/schedules', ...adminOnly, admin.createSchedule);
router.put('/admin/schedules/:id', ...adminOnly, admin.updateSchedule);
router.delete('/admin/schedules/:id', ...adminOnly, admin.deleteSchedule);

/* Demo housekeeping: rebuild the seeded data during a live demonstration. */
router.post('/admin/reseed', ...adminOnly, admin.reseedDemoData);
router.get('/admin/reseed', ...adminOnly, admin.reseedProgress);

export default router;
