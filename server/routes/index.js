import { Router } from 'express';

import * as auth from '../controllers/authController.js';
import * as admin from '../controllers/adminController.js';
import * as conductor from '../controllers/conductorController.js';
import * as pub from '../controllers/publicController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

/* ------------------------------------------------------------------ auth */
// One door for staff. The account's role decides which product they land in;
// the role boundary itself is enforced per-route below.
router.post('/auth/login', auth.login);
router.get('/auth/me', requireAuth, auth.me);

/* ---------------------------------------------------------------- public */
// No auth middleware below this line, on purpose. A passenger checking a bus
// should never meet a login screen.
router.get('/public/stations', pub.listStations);
router.get('/public/stations/:stationId/board', pub.stationBoard);
router.get('/public/routes', pub.listRoutes);
router.get('/public/trips', pub.listActiveTrips);
router.get('/public/trips/:tripId', pub.tripDetail);

/* ------------------------------------------------------------- conductor */
const conductorOnly = [requireAuth, requireRole('conductor')];

router.get('/conductor/trips', ...conductorOnly, conductor.myTrips);
router.get('/conductor/trips/:tripId', ...conductorOnly, conductor.myTrip);
router.post('/conductor/trips/:tripId/checkpoint-logs', ...conductorOnly, conductor.logUpdate);
router.post('/conductor/trips/:tripId/checkpoint-logs/sync', ...conductorOnly, conductor.syncQueue);

/* ----------------------------------------------------------------- admin */
const adminOnly = [requireAuth, requireRole('admin')];

router.get('/admin/dashboard', ...adminOnly, admin.dashboard);

router.get('/admin/checkpoints', ...adminOnly, admin.listCheckpoints);
router.post('/admin/checkpoints', ...adminOnly, admin.createCheckpoint);
router.put('/admin/checkpoints/:id', ...adminOnly, admin.updateCheckpoint);
router.delete('/admin/checkpoints/:id', ...adminOnly, admin.deleteCheckpoint);

router.get('/admin/routes', ...adminOnly, admin.listRoutes);
router.get('/admin/routes/:id', ...adminOnly, admin.getRoute);
router.post('/admin/routes', ...adminOnly, admin.createRoute);
router.put('/admin/routes/:id', ...adminOnly, admin.updateRoute);
router.delete('/admin/routes/:id', ...adminOnly, admin.deleteRoute);

router.get('/admin/buses', ...adminOnly, admin.listBuses);
router.post('/admin/buses', ...adminOnly, admin.createBus);
router.put('/admin/buses/:id', ...adminOnly, admin.updateBus);
router.delete('/admin/buses/:id', ...adminOnly, admin.deleteBus);

router.get('/admin/conductors', ...adminOnly, admin.listConductors);
router.post('/admin/conductors', ...adminOnly, admin.createConductor);
router.put('/admin/conductors/:id', ...adminOnly, admin.updateConductor);
router.delete('/admin/conductors/:id', ...adminOnly, admin.deleteConductor);

router.get('/admin/trips', ...adminOnly, admin.listTrips);
router.get('/admin/trips/:id', ...adminOnly, admin.getTrip);
router.post('/admin/trips', ...adminOnly, admin.createTrip);
router.put('/admin/trips/:id', ...adminOnly, admin.updateTrip);
router.delete('/admin/trips/:id', ...adminOnly, admin.deleteTrip);

export default router;
