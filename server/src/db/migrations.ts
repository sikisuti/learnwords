/**
 * Schema migrations, applied in order. Never edit an applied migration; append a new one.
 * Timestamps are ISO-8601 UTC strings ('YYYY-MM-DDTHH:MM:SS.sssZ') so SQLite date functions work on them.
 */
export const migrations: string[] = [
  /* 1: initial schema */ `
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
];
