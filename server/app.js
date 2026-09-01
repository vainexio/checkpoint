import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';

import apiRoutes from './routes/index.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';

/**
 * The Express app, with no database connection and no listener of its own.
 * server.js boots it for real; the integration tests mount it against an
 * in-memory MongoDB.
 */
export function createApp() {
  const app = express();

  const origins = (process.env.CLIENT_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim());

  app.use(cors({ origin: origins }));
  app.use(express.json({ limit: '256kb' }));

  app.get('/health', (req, res) => {
    res.json({
      ok: true,
      db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
      time: new Date(),
    });
  });

  app.use('/api', apiRoutes);
  app.use(notFound);
  app.use(errorHandler);

  return app;
}

export default createApp;
