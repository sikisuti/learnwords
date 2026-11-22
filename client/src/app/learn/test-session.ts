import type { DeckWord } from '../core/models';
import { shuffle, type CurrentCard, type Random, type Side } from './learning-session';

/**
 * A test of words the user picked, as a pure state machine. Nothing is saved: stages do not change.
 *
 * The test has two turns. The first shows each word once on a random side, the second (reshuffled) shows each
 * word on the side it did not show in the first. Within a turn, "again" (swipe right) moves the card to the back
 * and "done" (swipe down) takes it out; the turn ends when the queue is empty.
 */

export const TEST_TURNS = 2;

export interface TestState {
  words: DeckWord[];
  turn: number;
  /** word ids left in this turn; the first one is the card on top */
  queue: number[];
  /** the side each word shows first in the current turn */
  sides: Record<number, Side>;
  /** increases on every action, so each shown card gets a fresh identity */
  step: number;
  finished: boolean;
}

const other = (side: Side): Side => (side === 'native' ? 'foreign' : 'native');

export function startTest(words: readonly DeckWord[], random: Random = Math.random): TestState {
  const sides: Record<number, Side> = {};
  for (const word of words) sides[word.id] = random() < 0.5 ? 'native' : 'foreign';
  return {
    words: [...words],
    turn: 0,
    queue: shuffle(words.map((w) => w.id), random),
    sides,
    step: 0,
    finished: !words.length,
  };
}

export function currentCard(state: TestState): CurrentCard | null {
  if (state.finished || !state.queue.length) return null;
  const id = state.queue[0];
  return { word: state.words.find((w) => w.id === id)!, side: state.sides[id], key: state.step };
}

/** Swipe right: put the card at the back to see it again in this turn. */
export function again(state: TestState): TestState {
  if (state.finished || !state.queue.length) return state;
  const [first, ...rest] = state.queue;
  return { ...state, queue: [...rest, first], step: state.step + 1 };
}

/** Swipe down: take the card out for this turn. Moves on to the swapped turn, then finishes. */
export function done(state: TestState, random: Random = Math.random): TestState {
  if (state.finished || !state.queue.length) return state;
  const queue = state.queue.slice(1);
  if (queue.length) return { ...state, queue, step: state.step + 1 };
  if (state.turn + 1 < TEST_TURNS) {
    const sides: Record<number, Side> = {};
    for (const word of state.words) sides[word.id] = other(state.sides[word.id]);
    return {
      ...state,
      turn: state.turn + 1,
      queue: shuffle(state.words.map((w) => w.id), random),
      sides,
      step: state.step + 1,
    };
  }
  return { ...state, queue, finished: true, step: state.step + 1 };
}

/** Progress in percent, counting the current turn as partly done. */
export function testProgress(state: TestState): number {
  if (state.finished) return 100;
  const withinTurn = 1 - state.queue.length / state.words.length;
  return Math.round(((state.turn + withinTurn) / TEST_TURNS) * 100);
}

export function testTurnLabel(state: TestState): string {
  return state.turn === 0 ? 'Mixed' : 'Mixed · swapped';
}
