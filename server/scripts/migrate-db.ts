/**
 * Brings the database schema up to date: backs the database up, then applies the pending migrations from
 * src/db/migrations.ts in one transaction (if one fails, nothing changes). deploy/install-release.sh runs it
 * with the new release before switching to it. The app also migrates at startup, so this is optional elsewhere.
 *
 *   node dist/scripts/migrate-db.js [--db <path>] [--status] [--backup-dir <dir>] [--keep 14]
 *
 * --status only lists the applied and pending migrations. The backup goes to <data>/backups/pre-migrate by
 * default and is only made when something is pending; the newest `keep` backups there are kept.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { backupDatabase } from '../src/db/backup.ts';
import { connect } from '../src/db/connection.ts';
import { migrate, schemaVersion } from '../src/db/migrate.ts';
import { migrations } from '../src/db/migrations.ts';

const dataDir = process.env.DATA_DIR ?? 'data';
const { values } = parseArgs({
  options: {
    db: { type: 'string', default: join(dataDir, 'learnwords.db') },
    status: { type: 'boolean', default: false },
    'backup-dir': { type: 'string', default: join(dataDir, 'backups', 'pre-migrate') },
    keep: { type: 'string', default: '14' },
  },
});

const exists = existsSync(values.db);
const db = connect(values.db);
try {
  const version = schemaVersion(db);
  console.log(`Database ${values.db}: schema version ${version}, this build has ${migrations.length}`);
  migrations.forEach(({ name }, i) => console.log(`  ${i < version ? 'applied' : 'pending'}  ${i + 1} ${name}`));

  if (version > migrations.length) {
    console.error('The database is newer than this build.');
    process.exitCode = 1;
  } else if (!values.status && version < migrations.length) {
    if (exists) {
      const { path, removed } = backupDatabase(values.db, values['backup-dir'], Number(values.keep) || 14);
      console.log(`Backup written to ${path}`);
      for (const name of removed) console.log(`Removed old backup ${name}`);
    }
    const applied = migrate(db);
    console.log(`Applied ${applied.length} migration(s); schema version is now ${schemaVersion(db)}`);
  } else if (!values.status) {
    console.log('Nothing to migrate');
  }
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  db.close();
}
