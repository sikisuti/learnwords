import type { Deck, DeckWord } from '../core/models';

/**
 * The learning process as a pure, serializable state machine.
 *
 * A deck goes through 8 turns: 3 showing the native side first, 3 showing the foreign side first, then
 * 2 mixed turns. A mixed turn has two passes: the first shows each card on a random side, the second shows
 * each card on the side it did not show before. Each turn uses all learn words plus that turn's known word.
 *
 * In a pass the cards form a queue: "again" (swipe right) moves the current card to the back, "done"
 * (swipe down) takes it out for this pass. The pass ends when the queue is empty.
 */

export type Side = 'native' | 'foreign';
export type TurnKind = Side | 'mixed';

export const TURNS: readonly TurnKind[] = ['native', 'native', 'native', 'foreign', 'foreign', 'foreign', 'mixed', 'mixed'];
export const TOTAL_PASSES = TURNS.reduce((sum, kind) => sum + passesIn(kind), 0);

export interface SessionState {
  version: 1;
  userId: number;
  deck: Deck;
  turn: number;
  pass: number;
  /** word ids left in this pass; the first one is the card on top */
  queue: number[];
  /** the side each card shows first in this pass */
  sides: Record<number, Side>;
  /** increases on every action, so each shown card gets a fresh identity */
  step: number;
  finished: boolean;
}

export interface CurrentCard {
  word: DeckWord;
  side: Side;
  known: boolean;
  key: number;
}

export type Random = () => number;

function passesIn(kind: TurnKind): number {
  return kind === 'mixed' ? 2 : 1;
}

const other = (side: Side): Side => (side === 'native' ? 'foreign' : 'native');

export function shuffle<T>(items: readonly T[], random: Random = Math.random): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/** Word ids in a turn: every learn word plus the turn's known word, if there is one. */
export function turnWordIds(deck: Deck, turn: number): number[] {
  const known = deck.known[turn];
  return [...deck.learn.map((w) => w.id), ...(known ? [known.id] : [])];
}

function beginPass(state: SessionState, turn: number, pass: number, random: Random): SessionState {
  const kind = TURNS[turn];
  const queue = shuffle(turnWordIds(state.deck, turn), random);
  const sides: Record<number, Side> = {};
  for (const id of queue) {
    if (kind !== 'mixed') sides[id] = kind;
    else if (pass === 0) sides[id] = random() < 0.5 ? 'native' : 'foreign';
    else sides[id] = other(state.sides[id]);
  }
  return { ...state, turn, pass, queue, sides, step: state.step + 1 };
}

export function startSession(userId: number, deck: Deck, random: Random = Math.random): SessionState {
  const empty: SessionState = { version: 1, userId, deck, turn: 0, pass: 0, queue: [], sides: {}, step: 0, finished: false };
  return beginPass(empty, 0, 0, random);
}

export function currentCard(state: SessionState): CurrentCard | null {
  if (state.finished || !state.queue.length) return null;
  const id = state.queue[0];
  const known = state.deck.known.find((w) => w.id === id);
  const word = known ?? state.deck.learn.find((w) => w.id === id)!;
  return { word, side: state.sides[id], known: !!known, key: state.step };
}

/** Swipe right: put the card at the bottom of the deck to see it again in this pass. */
export function again(state: SessionState): SessionState {
  if (state.finished || !state.queue.length) return state;
  const [first, ...rest] = state.queue;
  return { ...state, queue: [...rest, first], step: state.step + 1 };
}

/** Swipe down: take the card out for this pass. Moves on to the next pass when the queue runs out. */
export function done(state: SessionState, random: Random = Math.random): SessionState {
  if (state.finished || !state.queue.length) return state;
  const queue = state.queue.slice(1);
  if (queue.length) return { ...state, queue, step: state.step + 1 };

  if (state.pass + 1 < passesIn(TURNS[state.turn])) return beginPass(state, state.turn, state.pass + 1, random);
  if (state.turn + 1 < TURNS.length) return beginPass(state, state.turn + 1, 0, random);
  return { ...state, queue, finished: true, step: state.step + 1 };
}

/** How many passes are complete, for the progress bar. */
export function completedPasses(state: SessionState): number {
  if (state.finished) return TOTAL_PASSES;
  return TURNS.slice(0, state.turn).reduce((sum, kind) => sum + passesIn(kind), 0) + state.pass;
}

export function turnLabel(state: SessionState): string {
  const kind = TURNS[state.turn];
  if (kind === 'native') return 'Native first';
  if (kind === 'foreign') return 'Foreign first';
  return state.pass === 0 ? 'Mixed' : 'Mixed · swapped';
}

// Persistence, so an interrupted session can be resumed.

const storageKey = (userId: number) => `learnwords.session.${userId}`;

export function saveSession(state: SessionState, storage: Storage | undefined = globalThis.localStorage): void {
  try {
    storage?.setItem(storageKey(state.userId), JSON.stringify(state));
  } catch {
    // Storage full or blocked: the session still works, it just cannot be resumed.
  }
}

export function loadSession(userId: number, storage: Storage | undefined = globalThis.localStorage): SessionState | null {
  try {
    const raw = storage?.getItem(storageKey(userId));
    if (!raw) return null;
    const state = JSON.parse(raw) as SessionState;
    const valid =
      state?.version === 1 &&
      state.userId === userId &&
      Array.isArray(state.deck?.learn) &&
      Array.isArray(state.queue) &&
      state.turn >= 0 &&
      state.turn < TURNS.length;
    return valid ? state : null;
  } catch {
    return null;
  }
}

export function clearSession(userId: number, storage: Storage | undefined = globalThis.localStorage): void {
  try {
    storage?.removeItem(storageKey(userId));
  } catch {
    // ignore
  }
}
