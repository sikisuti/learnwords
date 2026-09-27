import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { migrate } from '../src/db/migrate.ts';
import { migrations } from '../src/db/migrations.ts';

test('migration 2 moves session_size from user to user_configuration', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(migrations[0]);
  db.exec('PRAGMA user_version = 1');
  const insert = db.prepare('INSERT INTO user (username, password_hash, session_size, created_at) VALUES (?, ?, ?, ?)');
  insert.run('alice', 'x', 12, '2026-01-01T00:00:00.000Z');
  insert.run('bob', 'x', 5, '2026-01-01T00:00:00.000Z');

  migrate(db);

  const columns = db.prepare('PRAGMA table_info(user)').all().map((c) => c.name);
  assert.ok(!columns.includes('session_size'));
  const config = db
    .prepare(
      `SELECT u.username, c.session_size AS sessionSize, c.fill_with_new_words AS fill
         FROM user_configuration c JOIN user u ON u.id = c.user_id ORDER BY u.username`,
    )
    .all()
    .map((r) => ({ ...r }));
  assert.deepEqual(config, [
    { username: 'alice', sessionSize: 12, fill: 0 },
    { username: 'bob', sessionSize: 5, fill: 0 },
  ]);
});
