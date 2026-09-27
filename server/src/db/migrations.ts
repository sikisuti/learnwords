import type { DatabaseSync } from 'node:sqlite';

export interface Migration {
  name: string;
  /** SQL script, or a function for changes SQL alone cannot make (e.g. data rewritten with app code) */
  up: string | ((db: DatabaseSync) => void);
}

/**
 * Schema migrations, applied in order by migrate(). Never edit or reorder an applied migration; append a new one.
 * Foreign keys are off while they run (and checked before commit), so a table can be rebuilt with the
 * create-copy-drop-rename steps from https://www.sqlite.org/lang_altertable.html#otheralter.
 * Timestamps are ISO-8601 UTC strings ('YYYY-MM-DDTHH:MM:SS.sssZ') so SQLite date functions work on them.
 */
export const migrations: Migration[] = [
  {
    name: 'initial schema',
    up: `
  CREATE TABLE level (
    id   INTEGER PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL
  );
  INSERT INTO level (id, code, name) VALUES
    (1, 'A1', 'Elementary'),
    (2, 'A2', 'Pre-intermediate'),
    (3, 'B1', 'Intermediate'),
    (4, 'B2', 'Upper intermediate'),
    (5, 'C1', 'Advanced'),
    (6, 'C2', 'Proficient'),
    (7, '?',  'Unlevelled');

  CREATE TABLE user (
    id            INTEGER PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    session_size  INTEGER NOT NULL DEFAULT 5 CHECK (session_size BETWEEN 1 AND 50),
    created_at    TEXT NOT NULL
  );

  CREATE TABLE word (
    id               INTEGER PRIMARY KEY,
    native           TEXT NOT NULL,
    "foreign"        TEXT NOT NULL,
    foreign_norm     TEXT NOT NULL UNIQUE,
    definition       TEXT,
    example          TEXT,
    pronunciation    TEXT,
    level_id         INTEGER NOT NULL DEFAULT 7 REFERENCES level (id),
    lexical_category TEXT,
    created_at       TEXT NOT NULL
  );
  CREATE INDEX word_native_idx ON word (native COLLATE NOCASE);

  CREATE TABLE user_word (
    user_id      INTEGER NOT NULL REFERENCES user (id) ON DELETE CASCADE,
    word_id      INTEGER NOT NULL REFERENCES word (id) ON DELETE CASCADE,
    stage        INTEGER NOT NULL CHECK (stage BETWEEN 1 AND 6),
    last_learned TEXT NOT NULL,
    PRIMARY KEY (user_id, word_id)
  ) WITHOUT ROWID;
  CREATE INDEX user_word_stage_idx ON user_word (user_id, stage, last_learned);

  CREATE TABLE session (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES user (id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL
  ) WITHOUT ROWID;
  `,
  },
  {
    name: 'per-user settings move to user_configuration',
    up: `
  CREATE TABLE user_configuration (
    user_id             INTEGER PRIMARY KEY REFERENCES user (id) ON DELETE CASCADE,
    session_size        INTEGER NOT NULL DEFAULT 5 CHECK (session_size BETWEEN 1 AND 50),
    fill_with_new_words INTEGER NOT NULL DEFAULT 0 CHECK (fill_with_new_words IN (0, 1))
  );
  INSERT INTO user_configuration (user_id, session_size) SELECT id, session_size FROM user;
  ALTER TABLE user DROP COLUMN session_size;
  `,
  },
  {
    name: 'mark words a deck added to fill free slots',
    up: `
  ALTER TABLE user_word ADD COLUMN auto_added INTEGER NOT NULL DEFAULT 0 CHECK (auto_added IN (0, 1));
  `,
  },
];
