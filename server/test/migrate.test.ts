import assert from 'node:assert/strict';
import type { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { connect, openDatabase } from '../src/db/connection.ts';
import { migrate, schemaVersion } from '../src/db/migrate.ts';
import { migrations, type Migration } from '../src/db/migrations.ts';

const rows = (db: DatabaseSync, sql: string) =>
  db
    .prepare(sql)
    .all()
    .map((r) => ({ ...r }));

const tableExists = (db: DatabaseSync, name: string) =>
  db.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?").get(name) !== undefined;

/** A database with the current schema, one user and one of their words. */
function populated() {
  const db = openDatabase(':memory:');
  db.exec(`
    INSERT INTO user (id, username, password_hash, created_at) VALUES (1, 'alice', 'x', '2026-01-01T00:00:00.000Z');
    INSERT INTO user_configuration (user_id) VALUES (1);
    INSERT INTO word (id, native, "foreign", foreign_norm, created_at) VALUES (1, 'kutya', 'dog', 'dog', '2026-01-01T00:00:00.000Z');
    INSERT INTO user_word (user_id, word_id, stage, last_learned) VALUES (1, 1, 2, '2026-01-01T00:00:00.000Z');
  `);
  return db;
}

test('a new database gets every migration', () => {
  const db = connect(':memory:');
  assert.deepEqual(
    migrate(db).map((m) => m.name),
    migrations.map((m) => m.name),
  );
  assert.equal(schemaVersion(db), migrations.length);
  assert.deepEqual(migrate(db), [], 'running again applies nothing');
});

test('migration 2 moves session_size from user to user_configuration', () => {
  const db = connect(':memory:');
  migrate(db, migrations.slice(0, 1));
  const insert = db.prepare('INSERT INTO user (username, password_hash, session_size, created_at) VALUES (?, ?, ?, ?)');
  insert.run('alice', 'x', 12, '2026-01-01T00:00:00.000Z');
  insert.run('bob', 'x', 5, '2026-01-01T00:00:00.000Z');

  migrate(db);

  assert.ok(!rows(db, 'PRAGMA table_info(user)').some((c) => c.name === 'session_size'));
  assert.deepEqual(
    rows(
      db,
      `SELECT u.username, c.session_size AS sessionSize, c.fill_with_new_words AS fill
         FROM user_configuration c JOIN user u ON u.id = c.user_id ORDER BY u.username`,
    ),
    [
      { username: 'alice', sessionSize: 12, fill: 0 },
      { username: 'bob', sessionSize: 5, fill: 0 },
    ],
  );
});

test('a table can be rebuilt without cascading deletes to the rows referencing it', () => {
  const db = populated();
  const rebuildUser: Migration = {
    name: 'rebuild user with a display name',
    up: `
      CREATE TABLE user_new (
        id            INTEGER PRIMARY KEY,
        username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
        display_name  TEXT,
        password_hash TEXT NOT NULL,
        created_at    TEXT NOT NULL
      );
      INSERT INTO user_new (id, username, password_hash, created_at) SELECT id, username, password_hash, created_at FROM user;
      DROP TABLE user;
      ALTER TABLE user_new RENAME TO user;
    `,
  };

  migrate(db, [...migrations, rebuildUser]);

  assert.equal(schemaVersion(db), migrations.length + 1);
  assert.deepEqual(rows(db, 'SELECT user_id, word_id FROM user_word'), [{ user_id: 1, word_id: 1 }]);
  assert.deepEqual(rows(db, 'SELECT user_id FROM user_configuration'), [{ user_id: 1 }]);
  assert.equal((db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys, 1, 'switched back on');
  assert.throws(
    () => db.exec(`INSERT INTO user_word (user_id, word_id, stage, last_learned) VALUES (99, 1, 1, '')`),
    /FOREIGN KEY/,
    'references to the rebuilt table are still enforced',
  );
});

test('migrations can be functions', () => {
  const db = populated();
  const upperCase: Migration = {
    name: 'upper-case natives',
    up: (d) => {
      for (const { id, native } of d.prepare('SELECT id, native FROM word').all() as { id: number; native: string }[]) {
        d.prepare('UPDATE word SET native = ? WHERE id = ?').run(native.toUpperCase(), id);
      }
    },
  };
  migrate(db, [...migrations, upperCase]);
  assert.deepEqual(rows(db, 'SELECT native FROM word'), [{ native: 'KUTYA' }]);
});

test('when one pending migration fails, none of them are applied', () => {
  const db = populated();
  const good: Migration = { name: 'add a table', up: 'CREATE TABLE note (id INTEGER PRIMARY KEY)' };
  const bad: Migration = { name: 'typo', up: 'ALTER TABLE nope ADD COLUMN x TEXT' };

  assert.throws(
    () => migrate(db, [...migrations, good, bad]),
    new RegExp(String.raw`Migration ${migrations.length + 2} \(typo\) failed: no such table: nope`),
  );
  assert.equal(schemaVersion(db), migrations.length);
  assert.ok(!tableExists(db, 'note'));
  assert.equal((db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys, 1);
});

test('a migration that breaks foreign key references is rolled back', () => {
  const db = populated();
  const orphan: Migration = { name: 'drop users only', up: 'DELETE FROM user' };

  assert.throws(() => migrate(db, [...migrations, orphan]), /broken foreign key reference/);
  assert.equal(schemaVersion(db), migrations.length);
  assert.deepEqual(rows(db, 'SELECT username FROM user'), [{ username: 'alice' }]);
});

test('a database newer than the build is refused', () => {
  const db = populated();
  db.exec(`PRAGMA user_version = ${migrations.length + 1}`);
  assert.throws(
    () => migrate(db),
    new RegExp(`schema is at version ${migrations.length + 1}, but this build only knows ${migrations.length} migrations`),
  );
});
