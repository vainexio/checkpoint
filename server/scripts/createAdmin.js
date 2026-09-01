/**
 * Create or reset an admin account from the command line.
 *
 * The web setup route closes as soon as any account exists, which is right —
 * but it leaves one hole: an admin who forgets their password and has no second
 * admin to help. This is the way back in. It talks to whatever MONGODB_URI
 * points at, so it can be run locally against a production database by whoever
 * holds that connection string.
 *
 *   node scripts/createAdmin.js --username ops --name "Ops Admin" --password ...
 *
 * Passing an existing username resets that account's password rather than
 * failing, which is the point of having it.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

dotenv.config({
  path: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env'),
});

import mongoose from 'mongoose';
import { User } from '../models/index.js';

const arg = (flag) => {
  const i = process.argv.indexOf(`--${flag}`);
  return i === -1 ? null : process.argv[i + 1];
};

const username = arg('username');
const password = arg('password');
const name = arg('name') ?? username;

if (!username || !password) {
  console.error(
    'Usage: node scripts/createAdmin.js --username <name> --password <pass> [--name "Full Name"]'
  );
  process.exit(1);
}

if (password.length < 8) {
  console.error('Password must be at least 8 characters.');
  process.exit(1);
}

if (!process.env.MONGODB_URI) {
  console.error('MONGODB_URI is not set. Fill in server/.env first.');
  process.exit(1);
}

await mongoose.connect(process.env.MONGODB_URI);

const existing = await User.findOne({ username: username.toLowerCase().trim() });

if (existing) {
  existing.role = 'admin';
  existing.name = name;
  existing.isActive = true;
  existing.passwordHash = await User.hashPassword(password);
  await existing.save();
  console.log(`Reset the password for existing account "${existing.username}" (now admin).`);
} else {
  const admin = await User.create({
    name,
    username,
    role: 'admin',
    passwordHash: await User.hashPassword(password),
  });
  console.log(`Created admin "${admin.username}".`);
}

await mongoose.disconnect();
