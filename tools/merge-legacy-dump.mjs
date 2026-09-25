#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
/**
 * Merges the users, levels, words and word progress of the old MariaDB-based LearnWords
 * (a mysqldump of the `Auth` and `LearnWords` databases) into a new LearnWords SQLite database.
 *
 *   node merge-legacy-dump.mjs <dump.sql> --db <learnwords.db> [--password <pw>] [--dry-run]
 *
 * Standalone on purpose: needs only Node >= 24 (node:sqlite), no npm packages and no application code.
 * The target database must already have its schema, i.e. the app has been started against it once.
 * Stop the app and back up the database before running without --dry-run.
 *
 * Mapping (old -> new):
 *   Auth.Users            -> user       matched by username (case-insensitive); new users get the password
 *                                       "password" (or --password); existing users are left untouched
 *   LearnWords.levels     -> level      matched by code or name; "Manually inserted" -> "?" (Unlevelled);
 *                                       anything else unknown is added as a new level
 *   LearnWords.words      -> word       matched by normalized foreign text; existing words are left untouched,
 *                                       old duplicates collapse into one word; audioFile is dropped
 *   LearnWords.userWords  -> user_word  stage = min(state, 6); if the pair already exists, the more advanced
 *                                       progress (higher stage, then later last_learned) is kept
 *
 * Re-running with the same dump changes nothing.
 */
import { randomBytes, scryptSync } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parseArgs } from 'node:util';

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    db: { type: 'string' },
    password: { type: 'string', default: 'password' },
    'dry-run': { type: 'boolean', default: false },
  },
});

const dumpPath = positionals[0];
if (!dumpPath || !args.db) {
  console.error('Usage: node merge-legacy-dump.mjs <dump.sql> --db <learnwords.db> [--password <pw>] [--dry-run]');
  process.exit(1);
}
if (!existsSync(resolve(args.db))) {
  console.error(`Database ${resolve(args.db)} does not exist. Start the app once to create it.`);
  process.exit(1);
}

const KNOWN_STAGE = 6;
const LEVEL_ALIASES = { 'manually inserted': '?' };

// ---------------------------------------------------------------------------------------------------------------
// mysqldump parsing
// ---------------------------------------------------------------------------------------------------------------

const WANTED = new Set(['Auth.Users', 'LearnWords.levels', 'LearnWords.userWords', 'LearnWords.words']);

/** Returns Map<"db.table", object[]> for the wanted tables, rows keyed by column name. */
function parseDump(text) {
  const columns = new Map();
  const tables = new Map([...WANTED].map((name) => [name, []]));
  let database = null;
  let creating = null;

  for (const rawLine of text.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;

    let m = /^USE `([^`]+)`;/.exec(line);
    if (m) {
      database = m[1];
      continue;
    }
    m = /^CREATE TABLE `([^`]+)` \(/.exec(line);
    if (m) {
      creating = { name: `${database}.${m[1]}`, cols: [] };
      continue;
    }
    if (creating) {
      m = /^\s+`([^`]+)` /.exec(line);
      if (m) creating.cols.push(m[1]);
      else if (line.startsWith(')')) {
        columns.set(creating.name, creating.cols);
        creating = null;
      }
      continue;
    }
    m = /^INSERT INTO `([^`]+)`\s*(?:\(([^)]*)\)\s*)?VALUES\s*/.exec(line);
    if (m) {
      const name = `${database}.${m[1]}`;
      if (!WANTED.has(name)) continue;
      const cols = m[2] ? m[2].split(',').map((c) => c.trim().replace(/`/g, '')) : columns.get(name);
      if (!cols) throw new Error(`No column list for ${name}`);
      for (const tuple of parseTuples(line, m[0].length)) {
        if (tuple.length !== cols.length) throw new Error(`${name}: expected ${cols.length} values, got ${tuple.length}`);
        tables.get(name).push(Object.fromEntries(cols.map((c, i) => [c, tuple[i]])));
      }
    }
  }
  return tables;
}

const ESCAPES = { 0: '\0', b: '\b', n: '\n', r: '\r', t: '\t', Z: '\x1a' };

/** Parses `(v, ...),(v, ...);` starting at `pos`. Values are strings, numbers or null. */
function parseTuples(sql, pos) {
  const rows = [];
  let i = pos;
  const skipSpaces = () => {
    while (sql[i] === ' ' || sql[i] === '\t') i++;
  };
  for (;;) {
    skipSpaces();
    if (sql[i] !== '(') throw new Error(`Unexpected "${sql[i]}" at ${i} in INSERT`);
    i++;
    const row = [];
    for (;;) {
      skipSpaces();
      if (sql[i] === "'") {
        i++;
        let out = '';
        let from = i;
        for (;;) {
          const c = sql[i];
          if (c === undefined) throw new Error('Unterminated string in INSERT');
          if (c === '\\') {
            out += sql.slice(from, i) + (ESCAPES[sql[i + 1]] ?? sql[i + 1]);
            i += 2;
            from = i;
          } else if (c === "'" && sql[i + 1] === "'") {
            out += sql.slice(from, i) + "'";
            i += 2;
            from = i;
          } else if (c === "'") {
            out += sql.slice(from, i);
            i++;
            break;
          } else i++;
        }
        row.push(out);
      } else {
        let j = i;
        while (j < sql.length && sql[j] !== ',' && sql[j] !== ')') j++;
        const raw = sql.slice(i, j).trim();
        i = j;
        row.push(raw.toUpperCase() === 'NULL' ? null : Number(raw));
      }
      skipSpaces();
      if (sql[i] === ',') i++;
      else if (sql[i] === ')') {
        i++;
        break;
      } else throw new Error(`Unexpected "${sql[i]}" at ${i} in INSERT`);
    }
    rows.push(row);
    skipSpaces();
    if (sql[i] === ',') i++;
    else if (sql[i] === ';' || i >= sql.length) return rows;
    else throw new Error(`Unexpected "${sql[i]}" at ${i} in INSERT`);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Conversions (kept in sync with the app's formats by hand)
// ---------------------------------------------------------------------------------------------------------------

/** Same key the app uses for word.foreign_norm. */
const normalizeForeign = (text) => text.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();

const blankToNull = (value) => (value == null || !String(value).trim() ? null : String(value).trim());

/** Same format the app verifies: scrypt$N$r$p$salt$key (base64). */
function hashPassword(password) {
  const N = 16384, r = 8, p = 1;
  const salt = randomBytes(16);
  const key = scryptSync(password.normalize('NFKC'), salt, 32, { N, r, p });
  return ['scrypt', N, r, p, salt.toString('base64'), key.toString('base64')].join('$');
}

/** MariaDB 'YYYY-MM-DD HH:MM:SS' (dumped in UTC) -> ISO-8601, or null for zero/invalid dates. */
function toIso(value) {
  if (typeof value !== 'string' || value.startsWith('0000')) return null;
  const date = new Date(`${value.replace(' ', 'T')}Z`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// ---------------------------------------------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------------------------------------------

const tables = parseDump(readFileSync(resolve(dumpPath), 'utf8'));
const oldUsers = tables.get('Auth.Users');
const oldLevels = tables.get('LearnWords.levels');
const oldWords = tables.get('LearnWords.words');
const oldUserWords = tables.get('LearnWords.userWords');
console.log(
  `Dump: ${oldUsers.length} users, ${oldLevels.length} levels, ${oldWords.length} words, ${oldUserWords.length} user words.`,
);

const db = new DatabaseSync(resolve(args.db));
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA busy_timeout = 5000');

const existingTables = new Set(
  db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name),
);
const missing = ['user', 'level', 'word', 'user_word'].filter((name) => !existingTables.has(name));
if (missing.length) {
  console.error(`Database has no ${missing.join(', ')} table(s). Start the app once to create the schema.`);
  process.exit(1);
}

const now = new Date().toISOString();
const report = [];

function mergeLevels() {
  const byKey = new Map();
  for (const level of db.prepare('SELECT id, code, name FROM level').all()) {
    byKey.set(level.code.toLowerCase(), level.id);
    byKey.set(level.name.toLowerCase(), level.id);
  }
  const insert = db.prepare('INSERT INTO level (code, name) VALUES (?, ?)');
  const map = new Map();
  let added = 0;
  for (const old of oldLevels) {
    const name = String(old.levelName).trim();
    const key = LEVEL_ALIASES[name.toLowerCase()] ?? name.toLowerCase();
    let id = byKey.get(key);
    if (id === undefined) {
      id = Number(insert.run(name, name).lastInsertRowid);
      byKey.set(key, id);
      added++;
    }
    map.set(old.id, id);
  }
  report.push(`levels: ${added} added, ${oldLevels.length - added} matched`);
  return map;
}

function mergeUsers() {
  const find = db.prepare('SELECT id FROM user WHERE username = ?');
  const insert = db.prepare('INSERT INTO user (username, password_hash, created_at) VALUES (?, ?, ?)');
  const map = new Map();
  const added = [];
  for (const old of oldUsers) {
    const username = String(old.username).trim();
    const existing = find.get(username);
    if (existing) map.set(old.id, existing.id);
    else {
      map.set(old.id, Number(insert.run(username, hashPassword(args.password), now).lastInsertRowid));
      added.push(username);
    }
  }
  report.push(
    `users: ${added.length} added${added.length ? ` (${added.join(', ')})` : ''}, ${oldUsers.length - added.length} already existed`,
  );
  return map;
}

function mergeWords(levelMap) {
  const unlevelledId = db.prepare("SELECT id FROM level WHERE code = '?'").get()?.id;
  const find = db.prepare('SELECT id FROM word WHERE foreign_norm = ?');
  const insert = db.prepare(
    `INSERT INTO word (native, "foreign", foreign_norm, definition, example, pronunciation, level_id, lexical_category, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const map = new Map();
  let added = 0, matched = 0, invalid = 0;
  for (const old of [...oldWords].sort((a, b) => a.id - b.id)) {
    const native = blankToNull(old.native);
    const foreign = blankToNull(old.foreignWord);
    if (!native || !foreign) {
      invalid++;
      continue;
    }
    const norm = normalizeForeign(foreign);
    const existing = find.get(norm);
    if (existing) {
      map.set(old.id, existing.id);
      matched++;
      continue;
    }
    const levelId = levelMap.get(old.levelID) ?? unlevelledId;
    const result = insert.run(
      native,
      foreign,
      norm,
      blankToNull(old.definition),
      blankToNull(old.exampleSentence),
      blankToNull(old.pronunciation),
      levelId,
      blankToNull(old.lexicalCategory),
      now,
    );
    map.set(old.id, Number(result.lastInsertRowid));
    added++;
  }
  report.push(`words: ${added} added, ${matched} matched an existing or duplicate word, ${invalid} skipped (blank text)`);
  return map;
}

function mergeUserWords(userMap, wordMap) {
  // Collapse old rows that land on the same (user, word), keeping the most advanced one.
  const best = new Map();
  let orphans = 0;
  for (const old of oldUserWords) {
    const userId = userMap.get(old.userID);
    const wordId = wordMap.get(old.wordID);
    if (userId === undefined || wordId === undefined) {
      orphans++;
      continue;
    }
    const row = {
      userId,
      wordId,
      stage: Math.min(Math.max(Number(old.state) || 1, 1), KNOWN_STAGE),
      lastLearned: toIso(old.lastLearned) ?? toIso(old.created) ?? now,
    };
    const key = `${userId}:${wordId}`;
    const current = best.get(key);
    if (!current || row.stage > current.stage || (row.stage === current.stage && row.lastLearned > current.lastLearned)) {
      best.set(key, row);
    }
  }

  const upsert = db.prepare(
    `INSERT INTO user_word (user_id, word_id, stage, last_learned) VALUES (?, ?, ?, ?)
     ON CONFLICT (user_id, word_id) DO UPDATE SET stage = excluded.stage, last_learned = excluded.last_learned
      WHERE excluded.stage > user_word.stage
         OR (excluded.stage = user_word.stage AND excluded.last_learned > user_word.last_learned)`,
  );
  const exists = db.prepare('SELECT 1 FROM user_word WHERE user_id = ? AND word_id = ?');
  let added = 0, updated = 0, kept = 0;
  for (const row of best.values()) {
    const existed = exists.get(row.userId, row.wordId) !== undefined;
    const { changes } = upsert.run(row.userId, row.wordId, row.stage, row.lastLearned);
    if (!existed) added++;
    else if (changes) updated++;
    else kept++;
  }
  report.push(
    `user words: ${added} added, ${updated} advanced, ${kept} kept as is, ` +
      `${oldUserWords.length - orphans - best.size} merged duplicates, ${orphans} skipped (unknown user or word)`,
  );
}

db.exec('BEGIN IMMEDIATE');
try {
  const levelMap = mergeLevels();
  const userMap = mergeUsers();
  const wordMap = mergeWords(levelMap);
  mergeUserWords(userMap, wordMap);
  if (args['dry-run']) db.exec('ROLLBACK');
  else db.exec('COMMIT');
} catch (err) {
  db.exec('ROLLBACK');
  throw err;
} finally {
  db.close();
}

for (const line of report) console.log(`  ${line}`);
console.log(args['dry-run'] ? 'Dry run: nothing was written.' : 'Merge committed.');
