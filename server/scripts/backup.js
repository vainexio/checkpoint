/**
 * Take a backup of the database, and say how to put it back.
 *
 * Atlas's free tier keeps no backups of its own, so the only copy of an
 * operator's history is the one someone remembers to take. This wraps
 * `mongodump` so that taking one is a single command with no connection string
 * to paste anywhere — it reads MONGODB_URI from server/.env like everything
 * else, and never prints it.
 *
 *   npm run backup                 -> backups/checkpoint-2026-09-24-1830.gz
 *   npm run backup -- --out path   -> somewhere else
 *
 * Restoring is deliberately not automated. It overwrites live data, so it is a
 * command someone types on purpose, having read what it does:
 *
 *   mongorestore --uri="<MONGODB_URI>" --gzip --archive=backups/<file>.gz --drop
 *
 * `--drop` replaces each collection in the archive. Without it the restore
 * merges into what is already there, which is almost never what is wanted.
 *
 * Needs the MongoDB Database Tools (mongodump/mongorestore) on PATH:
 * https://www.mongodb.com/docs/database-tools/installation/
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(here, '..', '.env') });

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI is not set. Copy server/.env.example to server/.env first.');
  process.exit(1);
}

// 2026-09-24-1830, so backups sort by name.
const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');

const outFlag = process.argv.indexOf('--out');
const target =
  outFlag !== -1 && process.argv[outFlag + 1]
    ? path.resolve(process.argv[outFlag + 1])
    : path.resolve(here, '..', '..', 'backups', `checkpoint-${stamp}.gz`);

fs.mkdirSync(path.dirname(target), { recursive: true });

// The URI carries the password, so it goes in as an argument to mongodump and
// is never echoed; only the file it produces is reported.
const dump = spawn(
  'mongodump',
  [`--uri=${uri}`, '--gzip', `--archive=${target}`],
  { stdio: ['ignore', 'inherit', 'inherit'] }
);

dump.on('error', (err) => {
  if (err.code === 'ENOENT') {
    console.error(
      'mongodump was not found. Install the MongoDB Database Tools:\n' +
        '  https://www.mongodb.com/docs/database-tools/installation/'
    );
    process.exit(1);
  }
  console.error('Backup failed:', err.message);
  process.exit(1);
});

dump.on('exit', (code) => {
  if (code !== 0) {
    console.error(`mongodump exited with ${code}. Nothing was written.`);
    process.exit(code ?? 1);
  }
  const mb = (fs.statSync(target).size / (1024 * 1024)).toFixed(1);
  console.log(`\nBacked up to ${target} (${mb} MB).`);
  console.log('Restore with:');
  console.log(`  mongorestore --uri="<MONGODB_URI>" --gzip --archive="${target}" --drop`);
});
