import type { DatabaseSync } from 'node:sqlite';
import { migrations as allMigrations, type Migration } from './migrations.ts';

/** Number of applied migrations, kept in PRAGMA user_version. */
export function schemaVersion(db: DatabaseSync): number {
  return (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
}

/**
 * Applies the pending migrations and returns them. They all run in one transaction, so if one fails the
 * database is left exactly as it was.
 *
 * Foreign keys are switched off while migrating: a table rebuild (create new table, copy rows, drop old
 * table, rename) would otherwise cascade the DROP to every referencing row. SQLite only allows switching
 * them outside a transaction, so the references are checked with foreign_key_check just before commit instead.
 */
export function migrate(db: DatabaseSync, migrations: readonly Migration[] = allMigrations): Migration[] {
  const current = schemaVersion(db);
  if (current > migrations.length) {
    throw new Error(
      `The database schema is at version ${current}, but this build only knows ${migrations.length} migrations. ` +
        'Deploy a newer build, or restore a backup made before the newer build was deployed.',
    );
  }
  const pending = migrations.slice(current);
  if (!pending.length) return [];

  const { foreign_keys: foreignKeys } = db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number };
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    db.exec('BEGIN IMMEDIATE');
    try {
      pending.forEach((migration, i) => {
        try {
          if (typeof migration.up === 'string') db.exec(migration.up);
          else migration.up(db);
        } catch (err) {
          throw new Error(`Migration ${current + i + 1} (${migration.name}) failed: ${(err as Error).message}`, {
            cause: err,
          });
        }
      });
      const broken = db.prepare('PRAGMA foreign_key_check').all();
      if (broken.length) {
        throw new Error(`Migrations leave ${broken.length} broken foreign key reference(s), e.g. ${JSON.stringify(broken[0])}`);
      }
      db.exec(`PRAGMA user_version = ${migrations.length}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  } finally {
    db.exec(`PRAGMA foreign_keys = ${foreignKeys ? 'ON' : 'OFF'}`);
  }
  return pending;
}
