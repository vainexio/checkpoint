import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

// Load server/.env by its own path, not the working directory's — so the app
// starts the same whether you run `node server.js` from here or
// `node server/server.js` from the repo root (which is what Render does).
dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '.env') });
import mongoose from 'mongoose';

import { createApp } from './app.js';
import { startTrafficRefresher } from './services/trafficRefresher.js';

const PORT = process.env.PORT || 4000;

async function start() {
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI is not set. Copy .env.example to .env and fill it in.');
    process.exit(1);
  }

  if (!process.env.JWT_SECRET) {
    console.error('JWT_SECRET is not set. Copy .env.example to .env and fill it in.');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);
  console.log('MongoDB connected.');

  createApp().listen(PORT, () => {
    console.log(`CHECKPOINT API listening on http://localhost:${PORT}`);
  });

  // Warms the traffic cache for the road buses are about to drive. Silently
  // does nothing when no TRAFFIC_API_KEY is set.
  startTrafficRefresher();
}

start().catch((err) => {
  console.error('Failed to start:', err.message);
  process.exit(1);
});
