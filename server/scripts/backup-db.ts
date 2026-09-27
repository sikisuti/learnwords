/**
 * Writes a consistent snapshot of the database (safe while the app is running) and keeps the newest N.
 *
 *   node dist/scripts/backup-db.js [--db <path>] [--dest <dir>] [--keep 14]
 *
 * Restore: stop the service, copy a backup over learnwords.db (delete learnwords.db-wal / -shm), start it.
 */
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { backupDatabase } from '../src/db/backup.ts';

const dataDir = process.env.DATA_DIR ?? 'data';
const { values } = parseArgs({
  options: {
    db: { type: 'string', default: join(dataDir, 'learnwords.db') },
    dest: { type: 'string', default: join(dataDir, 'backups') },
    keep: { type: 'string', default: '14' },
  },
});

const { path, removed } = backupDatabase(values.db, values.dest, Number(values.keep) || 14);
console.log(`Backup written to ${path}`);
for (const name of removed) console.log(`Removed old backup ${name}`);
