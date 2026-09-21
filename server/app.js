import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';

import apiRoutes from './routes/index.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import {
  demandFromPath,
  getTrafficStatus,
  noteTrafficDemand,
} from './services/trafficRefresher.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIST = path.resolve(here, '..', 'client', 'dist');

/**
 * The Express app, with no database connection and no listener of its own.
 * server.js boots it for real; the integration tests mount it against an
 * in-memory MongoDB.
 *
 * In production this also serves the built React app, so the whole product is
 * one service on one origin. That removes CORS entirely, removes the need for
 * the frontend and backend to know each other's URLs, and means a free-tier
 * deployment only has one thing to wake up.
 */
export function createApp() {
  const app = express();

  // Render puts one proxy in front of the app. Trusting exactly that hop makes
  // req.ip the caller's address, which the sign-in throttle counts by — and
  // trusting no more than that stops a caller spoofing X-Forwarded-For to
  // dodge it.
  app.set('trust proxy', 1);

  // Only relevant when the client is served from somewhere else (the Vite dev
  // server proxies instead, so this is a no-op in normal development too).
  const origins = (process.env.CLIENT_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim());

  app.use(cors({ origin: origins }));
  app.use(express.json({ limit: '256kb' }));

  app.get('/health', (req, res) => {
    res.json({
      ok: true,
      db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
      // Active, idle, paused (with the provider's reason) or disabled — so
      // missing traffic on a board can be explained without the server logs.
      traffic: getTrafficStatus(),
      time: new Date(),
    });
  });

  /**
   * Opening a board or a trip is what asks for live traffic, and only for the
   * buses on it (see trafficRefresher.js). Every other read — the stop list,
   * the map, admin lists, and above all /health, which a hosting platform
   * pings forever — costs nothing.
   */
  app.use('/api', (req, res, next) => {
    if (req.method === 'GET') noteTrafficDemand(demandFromPath(req.path));
    next();
  });

  app.use('/api', apiRoutes);

  if (fs.existsSync(CLIENT_DIST)) {
    app.use(express.static(CLIENT_DIST));

    /**
     * The client owns its own routing, so any path that is not an API call and
     * not a real file has to return index.html and let React decide. Without
     * this, refreshing on /stations/:id would 404 before the app ever loads.
     */
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path === '/health') return next();
      res.sendFile(path.join(CLIENT_DIST, 'index.html'));
    });

    console.log(`Serving the built client from ${CLIENT_DIST}`);
  }

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

export default createApp;
