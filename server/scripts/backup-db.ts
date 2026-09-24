/**
 * Writes a consistent snapshot of the database (safe while the app is running) and keeps the newest N.
 *
 *   node dist/scripts/backup-db.js [--db <path>] [--dest <dir>] [--keep 14]
 *
 * Restore: stop the service, copy a backup over learnwords.db (delete learnwords.db-wal / -shm), start it.
 */
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parseArgs } from 'node:util';

const dataDir = process.env.DATA_DIR ?? 'data';
const { values } = parseArgs({
  options: {
    db: { type: 'string', default: join(dataDir, 'learnwords.db') },
    dest: { type: 'string', default: join(dataDir, 'backups') },
    keep: { type: 'string', default: '14' },
  },
});

const dest = resolve(values.dest);
const keep = Math.max(1, Number(values.keep) || 14);
mkdirSync(dest, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const target = join(dest, `learnwords-${stamp}.db`);

const db = new DatabaseSync(resolve(values.db), { readOnly: true });
db.prepare('VACUUM INTO ?').run(target);
db.close();
console.log(`Backup written to ${target}`);

const old = readdirSync(dest)
  .filter((name) => /^learnwords-.*\.db$/.test(name))
  .sort()
  .reverse()
  .slice(keep);
for (const name of old) {
  rmSync(join(dest, name));
  console.log(`Removed old backup ${name}`);
}
