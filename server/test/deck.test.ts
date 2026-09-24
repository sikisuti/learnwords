import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildDeck, completeDeck, pickLearnWords, userStats } from '../src/services/deck.ts';
import { daysAgo, registerUser, seedUserWord, testApp } from './helpers.ts';

const foreigns = (words: { foreign: string }[]) => words.map((w) => w.foreign);

test('pickLearnWords takes 3 from the top and the rest from the bottom', () => {
  const list = Array.from({ length: 12 }, (_, i) => i);
  assert.deepEqual(pickLearnWords(list, 5), [0, 1, 2, 10, 11]);
  assert.deepEqual(pickLearnWords(list, 3), [0, 1, 2]);
  assert.deepEqual(pickLearnWords(list, 2), [0, 1]);
  assert.deepEqual(pickLearnWords(list, 10), [0, 1, 2, 5, 6, 7, 8, 9, 10, 11]);
  assert.deepEqual(pickLearnWords([0, 1, 2, 3], 5), [0, 1, 2, 3]);
});

test('deck: lowest stages first, highest stages last, plus the 8 least recently seen known words', async () => {
  const { app, db } = await testApp();
  const { id } = await registerUser(app);
  const now = new Date('2026-06-01T12:00:00.000Z');
  // 12 due words: stage 1 (w1-w4), stage 2 (w5-w8), stage 5 (w9-w12), all waited long enough.
  for (let i = 1; i <= 12; i++) seedUserWord(db, id, `w${i}`, i <= 4 ? 1 : i <= 8 ? 2 : 5, daysAgo(60 - i, now));
  // 10 known words; k1 was seen longest ago.
  for (let i = 1; i <= 10; i++) seedUserWord(db, id, `k${i}`, 6, daysAgo(100 - i, now));

  const deck = buildDeck(db, id, 5, now);
  assert.equal(deck.issuedAt, now.toISOString());
  assert.deepEqual(foreigns(deck.learn), ['w1', 'w2', 'w3', 'w11', 'w12']);
  assert.deepEqual(foreigns(deck.known), ['k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7', 'k8']);
});

test('deck only contains words that are due by the learning schedule', async () => {
  const { app, db } = await testApp();
  const { id } = await registerUser(app);
  const now = new Date('2026-06-01T12:00:00.000Z');
  const cases: [string, number, Date, boolean][] = [
    ['s1-just-added', 1, now, true],
    ['s2-2d', 2, daysAgo(2, now), false],
    ['s2-3d', 2, daysAgo(3, now), true],
    ['s3-6d', 3, daysAgo(6, now), false],
    ['s3-7d', 3, daysAgo(7, now), true],
    ['s4-13d', 4, daysAgo(13, now), false],
    ['s4-14d', 4, daysAgo(14, now), true],
    ['s5-apr-2', 5, new Date('2026-05-02T12:00:00.000Z'), false],
    ['s5-may-1', 5, new Date('2026-05-01T12:00:00.000Z'), true],
  ];
  for (const [name, stage, when] of cases) seedUserWord(db, id, name, stage, when);

  const deck = buildDeck(db, id, 50, now);
  const expected = cases.filter(([, , , due]) => due).map(([name]) => name);
  assert.deepEqual(foreigns(deck.learn).sort(), expected.sort());
  assert.equal(userStats(db, id, now).due, expected.length);
});

test("deck ignores other users' words and dictionary words not on the user's list", async () => {
  const { app, db } = await testApp();
  const alice = await registerUser(app, 'alice');
  const bob = await registerUser(app, 'bob');
  seedUserWord(db, alice.id, 'mine', 1, new Date());
  seedUserWord(db, bob.id, 'bobs', 1, new Date());
  seedUserWord(db, bob.id, 'bobs-known', 6, new Date());
  db.prepare(`INSERT INTO word (native, "foreign", foreign_norm, created_at) VALUES ('x', 'unlinked', 'unlinked', ?)`).run(
    new Date().toISOString(),
  );

  const res = await app.inject({ method: 'POST', url: '/api/sessions', headers: alice.headers });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(foreigns(res.json().learn), ['mine']);
  assert.deepEqual(res.json().known, []);
});

test('completing a deck advances learned words once and refreshes known words', async () => {
  const { app, db } = await testApp();
  const { id } = await registerUser(app);
  const issued = new Date('2026-06-01T12:00:00.000Z');
  const done = new Date('2026-06-01T12:20:00.000Z');
  const a = seedUserWord(db, id, 'a', 1, daysAgo(1, issued));
  const b = seedUserWord(db, id, 'b', 5, daysAgo(40, issued));
  const k = seedUserWord(db, id, 'k', 6, daysAgo(90, issued));
  const completion = { issuedAt: issued.toISOString(), learnIds: [a, b], knownIds: [k] };

  assert.deepEqual(completeDeck(db, id, completion, done), { advanced: 2, reviewed: 1 });
  assert.deepEqual(completeDeck(db, id, completion, done), { advanced: 0, reviewed: 0 }, 'resubmit is a no-op');

  const rows = db.prepare('SELECT word_id AS id, stage, last_learned AS at FROM user_word ORDER BY word_id').all();
  assert.deepEqual(
    rows.map((r) => ({ ...r })),
    [
      { id: a, stage: 2, at: done.toISOString() },
      { id: b, stage: 6, at: done.toISOString() },
      { id: k, stage: 6, at: done.toISOString() },
    ],
  );
});

test('complete endpoint validates input and only touches the caller’s words', async () => {
  const { app, db } = await testApp();
  const alice = await registerUser(app, 'alice');
  const bob = await registerUser(app, 'bob');
  const bobsWord = seedUserWord(db, bob.id, 'b', 1, daysAgo(1));

  const deck = (await app.inject({ method: 'POST', url: '/api/sessions', headers: alice.headers })).json();
  const res = await app.inject({
    method: 'POST',
    url: '/api/sessions/complete',
    headers: alice.headers,
    payload: { issuedAt: deck.issuedAt, learnIds: [bobsWord], knownIds: [] },
  });
  assert.deepEqual(res.json(), { advanced: 0, reviewed: 0 });

  const invalid = await app.inject({
    method: 'POST',
    url: '/api/sessions/complete',
    headers: alice.headers,
    payload: { issuedAt: 'yesterday', learnIds: [], knownIds: [] },
  });
  assert.equal(invalid.statusCode, 400);
});
