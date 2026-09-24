import type { Db } from '../db/connection.ts';
import { transaction } from '../db/connection.ts';

export const UNLEVELLED_ID = 7;

export interface Word {
  id: number;
  native: string;
  foreign: string;
  definition: string | null;
  example: string | null;
  pronunciation: string | null;
  level: string;
  lexicalCategory: string | null;
}

export interface WordInput {
  native: string;
  foreign: string;
  definition?: string | null;
  example?: string | null;
  pronunciation?: string | null;
  level?: string | null;
  lexicalCategory?: string | null;
}

export interface Level {
  id: number;
  code: string;
  name: string;
}

/** Key used to detect duplicate words: case, surrounding whitespace and Unicode composition are ignored. */
export function normalizeForeign(text: string): string {
  return text.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

/** SELECT list producing a Word from `word w JOIN level l`. */
export const WORD_COLUMNS = `w.id, w.native, w."foreign" AS "foreign", w.definition, w.example, w.pronunciation,
  l.code AS level, w.lexical_category AS lexicalCategory`;

const blankToNull = (value: string | null | undefined) => (value?.trim() ? value.trim() : null);

export function listLevels(db: Db): Level[] {
  return db.prepare('SELECT id, code, name FROM level ORDER BY id').all() as unknown as Level[];
}

export function levelIdFor(db: Db, code: string | null | undefined): number {
  if (!code?.trim()) return UNLEVELLED_ID;
  const row = db.prepare('SELECT id FROM level WHERE code = ?').get(code.trim().toUpperCase()) as { id: number } | undefined;
  if (!row) throw new Error(`Unknown level "${code}"`);
  return row.id;
}

export function getWord(db: Db, id: number): Word | undefined {
  return db.prepare(`SELECT ${WORD_COLUMNS} FROM word w JOIN level l ON l.id = w.level_id WHERE w.id = ?`).get(id) as
    | Word
    | undefined;
}

function findWordIdByForeign(db: Db, foreign: string): number | undefined {
  const row = db.prepare('SELECT id FROM word WHERE foreign_norm = ?').get(normalizeForeign(foreign)) as
    | { id: number }
    | undefined;
  return row?.id;
}

function insertWord(db: Db, input: WordInput, now: Date): number {
  const result = db
    .prepare(
      `INSERT INTO word (native, "foreign", foreign_norm, definition, example, pronunciation, level_id, lexical_category, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.native.trim(),
      input.foreign.trim(),
      normalizeForeign(input.foreign),
      blankToNull(input.definition),
      blankToNull(input.example),
      blankToNull(input.pronunciation),
      levelIdFor(db, input.level),
      blankToNull(input.lexicalCategory),
      now.toISOString(),
    );
  return Number(result.lastInsertRowid);
}

/** Puts the word on the user's list at stage 1, or resets it to stage 1 if already there. Returns the previous stage. */
function linkToUser(db: Db, userId: number, wordId: number, now: Date): number | null {
  const previous = db.prepare('SELECT stage FROM user_word WHERE user_id = ? AND word_id = ?').get(userId, wordId) as
    | { stage: number }
    | undefined;
  db.prepare(
    `INSERT INTO user_word (user_id, word_id, stage, last_learned) VALUES (?, ?, 1, ?)
     ON CONFLICT (user_id, word_id) DO UPDATE SET stage = 1, last_learned = excluded.last_learned`,
  ).run(userId, wordId, now.toISOString());
  return previous?.stage ?? null;
}

export interface AddResult {
  word: Word;
  /** true when a new row was inserted into the global dictionary */
  created: boolean;
  /** the user's stage for this word before it was (re)set to 1; null if it was not on their list */
  previousStage: number | null;
}

/** Adds a word to the global dictionary unless its foreign text already exists, then links it to the user at stage 1. */
export function addOrLinkWord(db: Db, userId: number, input: WordInput, now = new Date()): AddResult {
  return transaction(db, () => {
    const existingId = findWordIdByForeign(db, input.foreign);
    const wordId = existingId ?? insertWord(db, input, now);
    const previousStage = linkToUser(db, userId, wordId, now);
    return { word: getWord(db, wordId)!, created: existingId === undefined, previousStage };
  });
}

/** Links an existing dictionary word to the user at stage 1. Returns undefined if the word does not exist. */
export function linkExistingWord(db: Db, userId: number, wordId: number, now = new Date()): AddResult | undefined {
  return transaction(db, () => {
    const word = getWord(db, wordId);
    if (!word) return undefined;
    return { word, created: false, previousStage: linkToUser(db, userId, wordId, now) };
  });
}

export interface SearchHit extends Word {
  /** the user's stage for this word, or null if it is not on their list */
  stage: number | null;
}

/** Dictionary words whose foreign or native text contains the query; prefix matches first. */
export function searchWords(db: Db, userId: number, query: string, limit = 10): SearchHit[] {
  const q = normalizeForeign(query).replace(/[!%_]/g, (c) => `!${c}`);
  if (!q) return [];
  return db
    .prepare(
      `SELECT ${WORD_COLUMNS}, uw.stage
         FROM word w
         JOIN level l ON l.id = w.level_id
         LEFT JOIN user_word uw ON uw.word_id = w.id AND uw.user_id = $user
        WHERE w.foreign_norm LIKE $contains ESCAPE '!' OR w.native LIKE $contains ESCAPE '!'
        ORDER BY (w.foreign_norm LIKE $prefix ESCAPE '!' OR w.native LIKE $prefix ESCAPE '!') DESC, w.foreign_norm
        LIMIT $limit`,
    )
    .all({ user: userId, contains: `%${q}%`, prefix: `${q}%`, limit }) as unknown as SearchHit[];
}

export type ImportOutcome = 'inserted' | 'updated' | 'skipped';

/** Used by the import script: inserts a dictionary word, or skips/updates it if the foreign text already exists. */
export function importWord(db: Db, input: WordInput, update: boolean, now = new Date()): ImportOutcome {
  const existingId = findWordIdByForeign(db, input.foreign);
  if (existingId === undefined) {
    insertWord(db, input, now);
    return 'inserted';
  }
  if (!update) return 'skipped';
  db.prepare(
    `UPDATE word SET native = ?, "foreign" = ?, definition = ?, example = ?, pronunciation = ?, level_id = ?, lexical_category = ?
      WHERE id = ?`,
  ).run(
    input.native.trim(),
    input.foreign.trim(),
    blankToNull(input.definition),
    blankToNull(input.example),
    blankToNull(input.pronunciation),
    levelIdFor(db, input.level),
    blankToNull(input.lexicalCategory),
    existingId,
  );
  return 'updated';
}
