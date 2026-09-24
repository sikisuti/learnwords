import type { Deck, DeckWord } from '../core/models';
import {
  TOTAL_PASSES,
  again,
  clearSession,
  completedPasses,
  currentCard,
  done,
  loadSession,
  saveSession,
  startSession,
  type SessionState,
} from './learning-session';

const word = (id: number, stage: number): DeckWord => ({
  id,
  native: `n${id}`,
  foreign: `f${id}`,
  definition: null,
  example: null,
  pronunciation: null,
  level: '?',
  lexicalCategory: null,
  stage,
});

const deck = (learn: number, known: number): Deck => ({
  issuedAt: '2026-06-01T12:00:00.000Z',
  learn: Array.from({ length: learn }, (_, i) => word(i + 1, 1)),
  known: Array.from({ length: known }, (_, i) => word(100 + i, 6)),
});

/** Deterministic pseudo-random numbers. */
function seeded(seed = 42) {
  return () => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed / 2 ** 31;
  };
}

/** Swipes every card down, recording what each pass showed. */
function runToEnd(state: SessionState, random = seeded()) {
  const passes: { turn: number; pass: number; shown: { id: number; side: string }[] }[] = [];
  while (!state.finished) {
    const key = `${state.turn}.${state.pass}`;
    if (passes.at(-1) === undefined || `${passes.at(-1)!.turn}.${passes.at(-1)!.pass}` !== key) {
      passes.push({ turn: state.turn, pass: state.pass, shown: [] });
    }
    const card = currentCard(state)!;
    passes.at(-1)!.shown.push({ id: card.word.id, side: card.side });
    state = done(state, random);
  }
  return passes;
}

describe('learning session', () => {
  it('runs 8 turns in 10 passes: 3 native, 3 foreign, 2 mixed pairs', () => {
    const passes = runToEnd(startSession(1, deck(5, 8), seeded()));
    expect(passes.length).toBe(TOTAL_PASSES);
    expect(TOTAL_PASSES).toBe(10);
    expect(passes.map((p) => `${p.turn}.${p.pass}`)).toEqual([
      '0.0', '1.0', '2.0', '3.0', '4.0', '5.0', '6.0', '6.1', '7.0', '7.1',
    ]);
    for (const p of passes.slice(0, 3)) expect(p.shown.every((s) => s.side === 'native')).toBe(true);
    for (const p of passes.slice(3, 6)) expect(p.shown.every((s) => s.side === 'foreign')).toBe(true);
  });

  it('adds one different known word to each turn, in both halves of a mixed pair', () => {
    const passes = runToEnd(startSession(1, deck(5, 8), seeded()));
    for (const p of passes) {
      const ids = p.shown.map((s) => s.id).sort((a, b) => a - b);
      expect(ids).toEqual([1, 2, 3, 4, 5, 100 + p.turn]);
    }
  });

  it('works with fewer than 8 known words', () => {
    const passes = runToEnd(startSession(1, deck(2, 1), seeded()));
    expect(passes[0].shown.map((s) => s.id).sort()).toEqual([1, 100, 2].sort());
    expect(passes[1].shown.map((s) => s.id).sort()).toEqual([1, 2]);
  });

  it('shows the opposite side in the second half of a mixed pair', () => {
    const passes = runToEnd(startSession(1, deck(6, 8), seeded(7)));
    for (const [first, second] of [
      [passes[6], passes[7]],
      [passes[8], passes[9]],
    ]) {
      for (const { id, side } of first.shown) {
        const later = second.shown.find((s) => s.id === id)!;
        expect(later.side).not.toBe(side);
      }
    }
  });

  it('again moves the card to the bottom; done removes it for the pass', () => {
    let state = startSession(1, deck(3, 0), seeded());
    const [a, b, c] = state.queue;
    state = again(state);
    expect(state.queue).toEqual([b, c, a]);
    expect(state.turn).toBe(0);
    state = done(state);
    expect(state.queue).toEqual([c, a]);
    state = done(done(state));
    expect(state.turn).toBe(1);
    expect(state.queue.length).toBe(3);
    expect(completedPasses(state)).toBe(1);
  });

  it('gives each shown card a new key, even the same card shown again', () => {
    let state = startSession(1, deck(1, 0), seeded());
    const first = currentCard(state)!;
    state = again(state);
    const second = currentCard(state)!;
    expect(second.word.id).toBe(first.word.id);
    expect(second.key).not.toBe(first.key);
  });

  it('saves and resumes at the same card', () => {
    const storage = new Map<string, string>();
    const fake = {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => void storage.set(k, v),
      removeItem: (k: string) => void storage.delete(k),
    } as Storage;

    let state = startSession(7, deck(4, 8), seeded());
    state = done(again(done(state)));
    saveSession(state, fake);

    const resumed = loadSession(7, fake)!;
    expect(resumed).toEqual(state);
    expect(currentCard(resumed)).toEqual(currentCard(state));
    expect(loadSession(8, fake)).toBeNull();

    clearSession(7, fake);
    expect(loadSession(7, fake)).toBeNull();
  });

  it('ignores corrupt saved data', () => {
    const fake = { getItem: () => '{not json' } as unknown as Storage;
    expect(loadSession(1, fake)).toBeNull();
  });
});
