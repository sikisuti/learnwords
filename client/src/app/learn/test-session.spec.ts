import type { DeckWord } from '../core/models';
import { again, currentCard, done, startTest, testProgress, type TestState } from './test-session';

const word = (id: number, stage = 1): DeckWord => ({
  id,
  native: `n${id}`,
  foreign: `f${id}`,
  definition: null,
  example: null,
  pronunciation: null,
  level: '?',
  lexicalCategory: null,
  audio: null,
  stage,
  autoAdded: false,
});

const words = (n: number) => Array.from({ length: n }, (_, i) => word(i + 1));

/** Deterministic pseudo-random numbers. */
function seeded(seed = 42) {
  return () => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed / 2 ** 31;
  };
}

/** Swipes every card down, recording what each turn showed. */
function runToEnd(state: TestState, random = seeded()) {
  const turns: { id: number; side: string }[][] = [];
  while (!state.finished) {
    turns[state.turn] ??= [];
    const card = currentCard(state)!;
    turns[state.turn].push({ id: card.word.id, side: card.side });
    state = done(state, random);
  }
  return turns;
}

describe('test session', () => {
  it('shows every word once in each of two turns, the second on the other side', () => {
    const turns = runToEnd(startTest(words(6), seeded()));
    expect(turns.length).toBe(2);
    for (const turn of turns) expect(turn.map((c) => c.id).sort()).toEqual([1, 2, 3, 4, 5, 6]);
    for (const { id, side } of turns[1]) {
      const first = turns[0].find((c) => c.id === id)!;
      expect(side).not.toBe(first.side);
    }
  });

  it('picks the first side at random', () => {
    const turns = runToEnd(startTest(words(20), seeded(7)), seeded(7));
    const sides = new Set(turns[0].map((c) => c.side));
    expect(sides).toEqual(new Set(['native', 'foreign']));
  });

  it('again moves the card to the back of the current turn', () => {
    let state = startTest(words(3), seeded());
    const first = currentCard(state)!.word.id;
    state = again(state);
    expect(state.queue.at(-1)).toBe(first);
    expect(state.queue.length).toBe(3);
    expect(state.turn).toBe(0);
  });

  it('gives each shown card a fresh key and tracks progress to the end', () => {
    let state = startTest(words(2), seeded());
    expect(testProgress(state)).toBe(0);
    const key = currentCard(state)!.key;
    state = done(state);
    expect(currentCard(state)!.key).not.toBe(key);
    expect(testProgress(state)).toBe(25);
    state = done(state);
    expect(state.turn).toBe(1);
    expect(testProgress(state)).toBe(50);
    state = done(done(state));
    expect(state.finished).toBe(true);
    expect(currentCard(state)).toBeNull();
    expect(testProgress(state)).toBe(100);
  });

  it('an empty selection is finished right away', () => {
    expect(startTest([]).finished).toBe(true);
  });
});
