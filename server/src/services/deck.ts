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

export function buildDeck(db: Db, userId: number, sessionSize: number, now = new Date()): Deck {
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
 * Rows already updated after `issuedAt` are left alone, so a repeated submit changes nothing.
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
              WHERE user_id = ? AND stage < ${KNOWN_STAGE} AND last_learned < ?
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
