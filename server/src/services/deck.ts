import type { Db } from '../db/connection.ts';
import { transaction } from '../db/connection.ts';
import { WORD_COLUMNS, type Word } from './words.ts';

export const KNOWN_STAGE = 6;
/** One already-known word is mixed into each of the 8 turns (3 native + 3 foreign + 2 mixed pairs). */
export const KNOWN_WORDS_PER_DECK = 8;
/** How many of the lowest-stage (newest) words a deck starts with; the rest come from the highest stages. */
export const NEWEST_WORDS_PER_DECK = 3;

/**
 * A word at `stage` may move to the next stage once this long has passed since it reached `stage`
 * (SQLite date modifiers). Stage 1 words are always due.
 */
export const STAGE_WAIT: Record<number, string> = {
  2: '+3 days',
  3: '+7 days',
  4: '+14 days',
  5: '+1 month',
};

const DUE_CONDITION = `(uw.stage = 1 OR ${Object.entries(STAGE_WAIT)
  .map(([stage, wait]) => `(uw.stage = ${stage} AND datetime(uw.last_learned, '${wait}') <= datetime($now))`)
  .join(' OR ')})`;

export interface DeckWord extends Word {
  stage: number;
}

export interface Deck {
  /** ISO timestamp; completing the deck only updates words not learned since then */
  issuedAt: string;
  learn: DeckWord[];
  known: DeckWord[];
}

/** Picks `size` words: the `NEWEST_WORDS_PER_DECK` lowest-stage ones and the rest from the highest stages. */
export function pickLearnWords<T>(eligibleByStageAsc: T[], size: number): T[] {
  if (eligibleByStageAsc.length <= size) return eligibleByStageAsc;
  const top = Math.min(NEWEST_WORDS_PER_DECK, size);
  const bottom = size - top;
  return [...eligibleByStageAsc.slice(0, top), ...(bottom > 0 ? eligibleByStageAsc.slice(-bottom) : [])];
}

/**
 * Varies the configured session size so decks are not always the same length:
 * ±1 for sizes up to 5, ±2 above, both ends inclusive, but never below 1.
 */
export function randomSessionSize(configured: number, random = Math.random): number {
  const spread = configured < 6 ? 1 : 2;
  const size = configured - spread + Math.floor(random() * (2 * spread + 1));
  return Math.max(1, size);
}

export interface DeckOptions {
  sessionSize: number;
  /** fill the slots the user's own due words leave free with dictionary words new to the user */
  fillWithNewWords?: boolean;
}

/**
 * Links up to `count` dictionary words the user does not have yet to them at stage 1, easiest level first
 * (A1, A2, … C2, then unlevelled), in dictionary order within a level.
 */
function joinNewWords(db: Db, userId: number, count: number, joinedAt: string): DeckWord[] {
  const words = db
    .prepare(
      `SELECT ${WORD_COLUMNS}, 1 AS stage
         FROM word w
         JOIN level l ON l.id = w.level_id
        WHERE NOT EXISTS (SELECT 1 FROM user_word uw WHERE uw.user_id = $user AND uw.word_id = w.id)
        ORDER BY w.level_id ASC, w.id ASC
        LIMIT $count`,
    )
    .all({ user: userId, count }) as unknown as DeckWord[];
  const link = db.prepare('INSERT INTO user_word (user_id, word_id, stage, last_learned) VALUES (?, ?, 1, ?)');
  for (const word of words) link.run(userId, word.id, joinedAt);
  return words;
}

export function buildDeck(db: Db, userId: number, { sessionSize, fillWithNewWords = false }: DeckOptions, now = new Date()): Deck {
  return transaction(db, () => {
    const deck = selectDeck(db, userId, sessionSize, now);
    const free = sessionSize - deck.learn.length;
    if (fillWithNewWords && free > 0) deck.learn.push(...joinNewWords(db, userId, free, deck.issuedAt));
    return deck;
  });
}

function selectDeck(db: Db, userId: number, sessionSize: number, now: Date): Deck {
  const nowIso = now.toISOString();
  const eligible = db
    .prepare(
      `SELECT ${WORD_COLUMNS}, uw.stage
         FROM user_word uw
         JOIN word w ON w.id = uw.word_id
         JOIN level l ON l.id = w.level_id
        WHERE uw.user_id = $user AND uw.stage < ${KNOWN_STAGE} AND ${DUE_CONDITION}
        ORDER BY uw.stage ASC, uw.last_learned ASC, w.id ASC`,
    )
    .all({ user: userId, now: nowIso }) as unknown as DeckWord[];

  const known = db
    .prepare(
      `SELECT ${WORD_COLUMNS}, uw.stage
         FROM user_word uw
         JOIN word w ON w.id = uw.word_id
         JOIN level l ON l.id = w.level_id
        WHERE uw.user_id = $user AND uw.stage = ${KNOWN_STAGE}
        ORDER BY uw.last_learned ASC, w.id ASC
        LIMIT ${KNOWN_WORDS_PER_DECK}`,
    )
    .all({ user: userId }) as unknown as DeckWord[];

  return { issuedAt: nowIso, learn: pickLearnWords(eligible, sessionSize), known };
}

export interface Completion {
  issuedAt: string;
  learnIds: number[];
  knownIds: number[];
}

/**
 * Moves the learned words one stage up and refreshes the known words' last_learned.
 * Rows already updated after `issuedAt` are left alone, so a repeated submit changes nothing
 * (words joined to the user by the deck itself have last_learned = issuedAt and do advance).
 */
export function completeDeck(db: Db, userId: number, completion: Completion, now = new Date()) {
  const nowIso = now.toISOString();
  const placeholders = (ids: number[]) => ids.map(() => '?').join(', ');
  return transaction(db, () => {
    let advanced = 0;
    let reviewed = 0;
    if (completion.learnIds.length) {
      advanced = Number(
        db
          .prepare(
            `UPDATE user_word SET stage = stage + 1, last_learned = ?
              WHERE user_id = ? AND stage < ${KNOWN_STAGE} AND last_learned <= ?
                AND word_id IN (${placeholders(completion.learnIds)})`,
          )
          .run(nowIso, userId, completion.issuedAt, ...completion.learnIds).changes,
      );
    }
    if (completion.knownIds.length) {
      reviewed = Number(
        db
          .prepare(
            `UPDATE user_word SET last_learned = ?
              WHERE user_id = ? AND stage = ${KNOWN_STAGE} AND last_learned < ?
                AND word_id IN (${placeholders(completion.knownIds)})`,
          )
          .run(nowIso, userId, completion.issuedAt, ...completion.knownIds).changes,
      );
    }
    return { advanced, reviewed };
  });
}

/** Moves a word on the user's list straight to the known stage. Returns false if the word is not on their list. */
export function markKnown(db: Db, userId: number, wordId: number, now = new Date()): boolean {
  const result = db
    .prepare(`UPDATE user_word SET stage = ${KNOWN_STAGE}, last_learned = ? WHERE user_id = ? AND word_id = ?`)
    .run(now.toISOString(), userId, wordId);
  return Number(result.changes) > 0;
}

export interface Stats {
  due: number;
  learning: number;
  known: number;
}

export function userStats(db: Db, userId: number, now = new Date()): Stats {
  return db
    .prepare(
      `SELECT COALESCE(SUM(uw.stage < ${KNOWN_STAGE} AND ${DUE_CONDITION}), 0) AS due,
              COALESCE(SUM(uw.stage < ${KNOWN_STAGE}), 0) AS learning,
              COALESCE(SUM(uw.stage = ${KNOWN_STAGE}), 0) AS known
         FROM user_word uw WHERE uw.user_id = $user`,
    )
    .get({ user: userId, now: now.toISOString() }) as unknown as Stats;
}
