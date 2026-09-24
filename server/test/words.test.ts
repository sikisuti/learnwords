import assert from 'node:assert/strict';
import { test } from 'node:test';
import { importWord, normalizeForeign } from '../src/services/words.ts';
import { registerUser, testApp } from './helpers.ts';

const count = (db: { prepare: Function }, sql: string, ...params: unknown[]) =>
  (db.prepare(sql).get(...params) as { n: number }).n;

test('normalizeForeign ignores case, whitespace and Unicode composition', () => {
  assert.equal(normalizeForeign('  Das   Haus '), 'das haus');
  assert.equal(normalizeForeign('Café'), normalizeForeign('café'));
});

test('adding a word inserts it once and links it to the adding user only', async () => {
  const { app, db } = await testApp();
  const alice = await registerUser(app, 'alice');
  const bob = await registerUser(app, 'bob');

  const first = await app.inject({
    method: 'POST',
    url: '/api/words',
    headers: alice.headers,
    payload: { native: 'house', foreign: 'das Haus', level: 'A1', lexicalCategory: 'noun' },
  });
  assert.equal(first.statusCode, 201);
  assert.equal(first.json().created, true);
  assert.equal(first.json().word.level, 'A1');
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM user_word WHERE user_id = ?', bob.id), 0);

  const again = await app.inject({
    method: 'POST',
    url: '/api/words',
    headers: bob.headers,
    payload: { native: 'home', foreign: '  DAS HAUS ' },
  });
  assert.equal(again.statusCode, 200);
  assert.equal(again.json().created, false);
  assert.equal(again.json().previousStage, null);
  assert.equal(again.json().word.native, 'house', 'existing word is not overwritten');
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM word'), 1);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM user_word'), 2);
});

test('re-adding a word the user already has resets it to stage 1', async () => {
  const { app, db } = await testApp();
  const alice = await registerUser(app);
  const add = () =>
    app.inject({ method: 'POST', url: '/api/words', headers: alice.headers, payload: { native: 'dog', foreign: 'Hund' } });
  const { word } = (await add()).json();
  db.prepare('UPDATE user_word SET stage = 4 WHERE word_id = ?').run(word.id);
  const res = (await add()).json();
  assert.equal(res.previousStage, 4);
  assert.equal(count(db, 'SELECT stage AS n FROM user_word WHERE word_id = ?', word.id), 1);
});

test('manually added words without a level are unlevelled', async () => {
  const { app } = await testApp();
  const { headers } = await registerUser(app);
  const res = await app.inject({ method: 'POST', url: '/api/words', headers, payload: { native: 'cat', foreign: 'Katze' } });
  assert.equal(res.json().word.level, '?');
});

test('search finds dictionary words and reports the user stage; learn links them', async () => {
  const { app, db } = await testApp();
  const { headers } = await registerUser(app);
  importWord(db, { native: 'house', foreign: 'das Haus', level: 'A1' }, false);
  importWord(db, { native: 'household', foreign: 'der Haushalt', level: 'B1' }, false);
  importWord(db, { native: 'cat', foreign: 'die Katze', level: 'A1' }, false);
  importWord(db, { native: '100%', foreign: 'hundert Prozent' }, false);

  const hits = (await app.inject({ method: 'GET', url: '/api/words/search?q=haus', headers })).json();
  assert.deepEqual(
    hits.map((h: { foreign: string }) => h.foreign),
    ['das Haus', 'der Haushalt'],
  );
  assert.equal(hits[0].stage, null);

  const byNative = (await app.inject({ method: 'GET', url: '/api/words/search?q=Cat', headers })).json();
  assert.deepEqual(byNative.map((h: { foreign: string }) => h.foreign), ['die Katze']);

  const wildcard = (await app.inject({ method: 'GET', url: '/api/words/search?q=%25', headers })).json();
  assert.deepEqual(wildcard.map((h: { native: string }) => h.native), ['100%'], '% is matched literally');

  const learn = await app.inject({ method: 'POST', url: `/api/words/${hits[0].id}/learn`, headers });
  assert.equal(learn.statusCode, 200);
  const after = (await app.inject({ method: 'GET', url: '/api/words/search?q=haus', headers })).json();
  assert.equal(after[0].stage, 1);

  const missing = await app.inject({ method: 'POST', url: '/api/words/999/learn', headers });
  assert.equal(missing.statusCode, 404);
});

test('import skips existing words unless updating', async () => {
  const { db } = await testApp();
  assert.equal(importWord(db, { native: 'house', foreign: 'das Haus', level: 'A1' }, false), 'inserted');
  assert.equal(importWord(db, { native: 'home', foreign: 'Das Haus', level: 'A2' }, false), 'skipped');
  assert.equal(importWord(db, { native: 'home', foreign: 'Das Haus', level: 'A2' }, true), 'updated');
  assert.equal(count(db, "SELECT level_id AS n FROM word WHERE native = 'home'"), 2);
  assert.throws(() => importWord(db, { native: 'x', foreign: 'y', level: 'Z9' }, false), /Unknown level/);
});
