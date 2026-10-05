import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addOrLinkWord, normalizeForeign } from '../src/services/words.ts';
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

test('a new word keeps its pronunciation audio URL', async () => {
  const { app } = await testApp();
  const { headers } = await registerUser(app);
  const audio = 'https://media.merriam-webster.com/audio/prons/en/us/mp3/h/house001.mp3';
  const res = await app.inject({ method: 'POST', url: '/api/words', headers, payload: { native: 'ház', foreign: 'house', audio } });
  assert.equal(res.json().word.audio, audio);

  const hits = (await app.inject({ method: 'GET', url: '/api/words/search?q=house', headers })).json();
  assert.equal(hits[0].audio, audio);

  const plain = await app.inject({ method: 'POST', url: '/api/words', headers, payload: { native: 'kutya', foreign: 'dog' } });
  assert.equal(plain.json().word.audio, null);

  const notAUrl = await app.inject({
    method: 'POST',
    url: '/api/words',
    headers,
    payload: { native: 'macska', foreign: 'cat', audio: 'javascript:alert(1)' },
  });
  assert.equal(notAUrl.statusCode, 400);
});

test('a word can have several meanings, told apart by their definitions', async () => {
  const { app, db } = await testApp();
  const { headers } = await registerUser(app);
  const add = (payload: object) => app.inject({ method: 'POST', url: '/api/words', headers, payload });

  const building = await add({ native: 'ház', foreign: 'house', definition: 'a building in which a family lives' });
  const people = await add({ native: 'háznép', foreign: 'house', definition: 'the people who live in a house' });
  assert.equal(building.statusCode, 201);
  assert.equal(people.statusCode, 201);
  assert.notEqual(building.json().word.id, people.json().word.id);

  const again = await add({ native: 'épület', foreign: ' House ', definition: 'A building in which  a family LIVES' });
  assert.equal(again.statusCode, 200);
  assert.equal(again.json().word.id, building.json().word.id, 'same meaning despite case and spacing');
  assert.equal(again.json().word.native, 'ház');
  assert.equal(count(db, `SELECT COUNT(*) AS n FROM word WHERE foreign_norm = 'house'`), 2);

  const hits = (await app.inject({ method: 'GET', url: '/api/words/search?q=house', headers })).json();
  assert.deepEqual(
    hits.map((h: { definition: string }) => h.definition),
    ['a building in which a family lives', 'the people who live in a house'],
  );
});

test('a defined meaning fills in the word that has no definition yet', async () => {
  const { app, db } = await testApp();
  const { headers, id: userId } = await registerUser(app);
  const bob = await registerUser(app, 'bob');
  const old = addOrLinkWord(db, bob.id, { native: 'ház', foreign: 'house', pronunciation: '/haus/' }).word;
  const add = (payload: object) => app.inject({ method: 'POST', url: '/api/words', headers, payload });

  const filled = await add({
    native: 'épület',
    foreign: 'House',
    definition: 'a building in which a family lives',
    example: 'They bought a house.',
    pronunciation: '/ˈhaʊs/',
    lexicalCategory: 'noun',
    level: 'A1',
    audio: 'https://media.merriam-webster.com/audio/prons/en/us/mp3/h/house001.mp3',
  });
  assert.equal(filled.statusCode, 200);
  assert.equal(filled.json().filled, true);
  assert.equal(filled.json().created, false);
  assert.deepEqual(filled.json().word, {
    id: old.id,
    native: 'ház',
    foreign: 'house',
    definition: 'a building in which a family lives',
    example: 'They bought a house.',
    pronunciation: '/haus/',
    level: 'A1',
    lexicalCategory: 'noun',
    audio: 'https://media.merriam-webster.com/audio/prons/en/us/mp3/h/house001.mp3',
  });
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM user_word WHERE user_id = ? AND word_id = ?', userId, old.id), 1);

  const second = await add({ native: 'háznép', foreign: 'house', definition: 'the people who live in a house' });
  assert.equal(second.statusCode, 201, 'with no definition-less word left, another meaning is a new word');
  assert.equal(second.json().filled, false);

  const plain = await add({ native: 'ház', foreign: 'house' });
  assert.equal(plain.statusCode, 201, 'a word without a definition is its own meaning');
  const plainAgain = await add({ native: 'otthon', foreign: 'HOUSE' });
  assert.equal(plainAgain.statusCode, 200);
  assert.equal(plainAgain.json().word.id, plain.json().word.id);
  assert.equal(count(db, `SELECT COUNT(*) AS n FROM word WHERE foreign_norm = 'house'`), 3);
});

test('search finds dictionary words and reports the user stage; learn links them', async () => {
  const { app, db } = await testApp();
  const { headers } = await registerUser(app);
  const other = await registerUser(app, 'bob');
  addOrLinkWord(db, other.id, { native: 'house', foreign: 'das Haus', level: 'A1' });
  addOrLinkWord(db, other.id, { native: 'household', foreign: 'der Haushalt', level: 'B1' });
  addOrLinkWord(db, other.id, { native: 'cat', foreign: 'die Katze', level: 'A1' });
  addOrLinkWord(db, other.id, { native: '100%', foreign: 'hundert Prozent' });

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
