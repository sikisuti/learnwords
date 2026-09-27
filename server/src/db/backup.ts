import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const BACKUP_NAME = /^learnwords-.*\.db$/;

/**
 * Writes a consistent snapshot of the database to `destDir` (safe while the app is running) and deletes all but
 * the newest `keep` snapshots there. Returns the snapshot path and the names of the deleted ones.
 */
export function backupDatabase(dbPath: string, destDir: string, keep: number) {
  const dest = resolve(destDir);
  mkdirSync(dest, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const path = join(dest, `learnwords-${stamp}.db`);
  const db = new DatabaseSync(resolve(dbPath), { readOnly: true });
  try {
    db.prepare('VACUUM INTO ?').run(path);
  } finally {
    db.close();
  }

  const removed = readdirSync(dest)
    .filter((name) => BACKUP_NAME.test(name))
    .sort()
    .reverse()
    .slice(Math.max(1, keep));
  for (const name of removed) rmSync(join(dest, name));
  return { path, removed };
}
