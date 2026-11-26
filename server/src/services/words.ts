import type { Db } from '../db/connection.ts';
import { transaction } from '../db/connection.ts';
import { normalizeForeign } from './normalize.ts';

export { normalizeForeign };

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
  /** URL of a pronunciation recording (mp3), if any */
  audio: string | null;
}

export interface WordInput {
  native: string;
  foreign: string;
  definition?: string | null;
  example?: string | null;
  pronunciation?: string | null;
  level?: string | null;
  lexicalCategory?: string | null;
  audio?: string | null;
}

export interface Level {
  id: number;
  code: string;
  name: string;
}

/** SELECT list producing a Word from `word w JOIN level l`. */
export const WORD_COLUMNS = `w.id, w.native, w."foreign" AS "foreign", w.definition, w.example, w.pronunciation,
  l.code AS level, w.lexical_category AS lexicalCategory, w.audio`;

/** A word on a user's list. */
export interface DeckWord extends Word {
  stage: number;
  /** the word was put on the user's list by a deck filling its free slots, not by the user */
  autoAdded: boolean;
}

/** SELECT list producing a DeckWord (with auto_added still 0/1) from `user_word uw JOIN word w JOIN level l`. */
export const DECK_WORD_COLUMNS = `${WORD_COLUMNS}, uw.stage, uw.auto_added AS autoAdded`;

export const toDeckWords = <T extends DeckWord = DeckWord>(rows: unknown[]): T[] =>
  (rows as (Omit<T, 'autoAdded'> & { autoAdded: number })[]).map((row) => ({
    ...row,
    autoAdded: row.autoAdded === 1,
  })) as T[];

const blankToNull =(value: string | null | undefined) => (value?.trim() ? value.trim() : null);

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

/** Key of a definition; a missing definition is the empty string. */
const definitionKey = (definition: string | null | undefined) => normalizeForeign(definition ?? '');

/** The word with this foreign text and definition (a meaning), if the dictionary has it. */
function findMeaning(db: Db, foreign: string, definition: string | null | undefined): number | undefined {
  const row = db
    .prepare('SELECT id FROM word WHERE foreign_norm = ? AND definition_norm = ?')
    .get(normalizeForeign(foreign), definitionKey(definition)) as { id: number } | undefined;
  return row?.id;
}

/**
 * Gives the word with this foreign text and no definition (there is at most one) the input's definition, and fills
 * its other empty fields from the input; its native text stays. Returns the word's id, or undefined if there is none.
 */
function fillUndefinedWord(db: Db, input: WordInput): number | undefined {
  const row = db
    .prepare(
      `UPDATE word
          SET definition = $definition,
              definition_norm = $definitionNorm,
              example = coalesce(example, $example),
              pronunciation = coalesce(pronunciation, $pronunciation),
              lexical_category = coalesce(lexical_category, $lexicalCategory),
              audio = coalesce(audio, $audio),
              level_id = CASE WHEN level_id = $unlevelled THEN $levelId ELSE level_id END
        WHERE foreign_norm = $foreignNorm AND definition_norm = ''
        RETURNING id`,
    )
    .get({
      definition: blankToNull(input.definition),
      definitionNorm: definitionKey(input.definition),
      example: blankToNull(input.example),
      pronunciation: blankToNull(input.pronunciation),
      lexicalCategory: blankToNull(input.lexicalCategory),
      audio: blankToNull(input.audio),
      unlevelled: UNLEVELLED_ID,
      levelId: levelIdFor(db, input.level),
      foreignNorm: normalizeForeign(input.foreign),
    }) as { id: number } | undefined;
  return row?.id;
}

function insertWord(db: Db, input: WordInput, now: Date): number {
  const result = db
    .prepare(
      `INSERT INTO word (native, "foreign", foreign_norm, definition, definition_norm, example, pronunciation, level_id,
                         lexical_category, audio, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.native.trim(),
      input.foreign.trim(),
      normalizeForeign(input.foreign),
      blankToNull(input.definition),
      definitionKey(input.definition),
      blankToNull(input.example),
      blankToNull(input.pronunciation),
      levelIdFor(db, input.level),
      blankToNull(input.lexicalCategory),
      blankToNull(input.audio),
      now.toISOString(),
    );
  return Number(result.lastInsertRowid);
}

/**
 * Puts the word on the user's list at stage 1, or resets it to stage 1 if already there; either way the user chose
 * it, so it is no longer auto-added, and it counts as newly added. Returns the previous stage.
 */
function linkToUser(db: Db, userId: number, wordId: number, now: Date): number | null {
  const previous = db.prepare('SELECT stage FROM user_word WHERE user_id = ? AND word_id = ?').get(userId, wordId) as
    | { stage: number }
    | undefined;
  db.prepare(
    `INSERT INTO user_word (user_id, word_id, stage, last_learned, added_at) VALUES ($user, $word, 1, $now, $now)
     ON CONFLICT (user_id, word_id) DO UPDATE
       SET stage = 1, last_learned = excluded.last_learned, added_at = excluded.added_at, auto_added = 0`,
  ).run({ user: userId, word: wordId, now: now.toISOString() });
  return previous?.stage ?? null;
}

export interface AddResult {
  word: Word;
  /** true when a new row was inserted into the global dictionary */
  created: boolean;
  /** true when an existing word without a definition was given the input's definition (and empty fields) */
  filled: boolean;
  /** the user's stage for this word before it was (re)set to 1; null if it was not on their list */
  previousStage: number | null;
}

/**
 * Links the word to the user at stage 1, finding it in the global dictionary by its meaning (foreign text and
 * definition). If the dictionary does not have that meaning, an input with a definition fills in the word with
 * the same foreign text and no definition, if there is one; otherwise the input is added as a new word.
 * An existing word keeps its native text.
 */
export function addOrLinkWord(db: Db, userId: number, input: WordInput, now = new Date()): AddResult {
  return transaction(db, () => {
    const existingId = findMeaning(db, input.foreign, input.definition);
    const filledId = existingId ?? (blankToNull(input.definition) ? fillUndefinedWord(db, input) : undefined);
    const wordId = existingId ?? filledId ?? insertWord(db, input, now);
    const previousStage = linkToUser(db, userId, wordId, now);
    return {
      word: getWord(db, wordId)!,
      created: existingId === undefined && filledId === undefined,
      filled: existingId === undefined && filledId !== undefined,
      previousStage,
    };
  });
}

/** Links an existing dictionary word to the user at stage 1. Returns undefined if the word does not exist. */
export function linkExistingWord(db: Db, userId: number, wordId: number, now = new Date()): AddResult | undefined {
  return transaction(db, () => {
    const word = getWord(db, wordId);
    if (!word) return undefined;
    return { word, created: false, filled: false, previousStage: linkToUser(db, userId, wordId, now) };
  });
}

export interface UserWord extends DeckWord {
  /** ISO timestamp of when the word was put on the user's list (or last re-added) */
  addedAt: string;
}

/** Every word on the user's list, most recently added first. */
export function listUserWords(db: Db, userId: number): UserWord[] {
  return toDeckWords<UserWord>(
    db
      .prepare(
        `SELECT ${DECK_WORD_COLUMNS}, uw.added_at AS addedAt
           FROM user_word uw
           JOIN word w ON w.id = uw.word_id
           JOIN level l ON l.id = w.level_id
          WHERE uw.user_id = ?
          ORDER BY uw.added_at DESC, w.id DESC`,
      )
      .all(userId),
  );
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
        ORDER BY (w.foreign_norm LIKE $prefix ESCAPE '!' OR w.native LIKE $prefix ESCAPE '!') DESC, w.foreign_norm, w.id
        LIMIT $limit`,
    )
    .all({ user: userId, contains: `%${q}%`, prefix: `${q}%`, limit }) as unknown as SearchHit[];
}

/** The word if it is on the user's list, with the user's stage. */
export function getUserWord(db: Db, userId: number, wordId: number): UserWord | undefined {
  return toDeckWords<UserWord>(
    db
      .prepare(
        `SELECT ${DECK_WORD_COLUMNS}, uw.added_at AS addedAt
           FROM user_word uw
           JOIN word w ON w.id = uw.word_id
           JOIN level l ON l.id = w.level_id
          WHERE uw.user_id = ? AND uw.word_id = ?`,
      )
      .all(userId, wordId),
  )[0];
}

export type UpdateResult = { word: Word } | { notFound: true } | { duplicate: true };

/**
 * Rewrites the attributes of a word on the user's list. Only the word's own fields change: the user's stage and
 * every timestamp stay as they are. Fails if the word is not on the user's list, or if another word already has
 * the new foreign text and definition.
 */
export function updateWord(db: Db, userId: number, wordId: number, input: WordInput): UpdateResult {
  return transaction(db, () => {
    if (!getUserWord(db, userId, wordId)) return { notFound: true };
    const other = findMeaning(db, input.foreign, input.definition);
    if (other !== undefined && other !== wordId) return { duplicate: true };
    db.prepare(
      `UPDATE word
          SET native = $native,
              "foreign" = $foreign,
              foreign_norm = $foreignNorm,
              definition = $definition,
              definition_norm = $definitionNorm,
              example = $example,
              pronunciation = $pronunciation,
              level_id = $levelId,
              lexical_category = $lexicalCategory,
              audio = $audio
        WHERE id = $id`,
    ).run({
      native: input.native.trim(),
      foreign: input.foreign.trim(),
      foreignNorm: normalizeForeign(input.foreign),
      definition: blankToNull(input.definition),
      definitionNorm: definitionKey(input.definition),
      example: blankToNull(input.example),
      pronunciation: blankToNull(input.pronunciation),
      levelId: levelIdFor(db, input.level),
      lexicalCategory: blankToNull(input.lexicalCategory),
      audio: blankToNull(input.audio),
      id: wordId,
    });
    return { word: getWord(db, wordId)! };
  });
}
