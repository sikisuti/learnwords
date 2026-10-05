import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DictionaryError, DictionaryKeyError, audioUrl, cleanMarkup, lookupWord } from '../src/services/dictionary.ts';
import { registerUser, testApp } from './helpers.ts';

/** A trimmed-down Learner's response for "test". */
const TEST_ENTRIES = [
  {
    meta: { id: 'test:1' },
    hwi: { hw: 'test', prs: [{ ipa: 'ˈtɛst', sound: { audio: 'test0001' } }] },
    fl: 'noun',
    def: [
      {
        sseq: [
          [
            [
              'sense',
              {
                sn: '1 a',
                dt: [
                  ['text', '{bc}a set of questions or problems that are designed to measure a person\'s {it}knowledge{/it}'],
                  ['vis', [{ t: 'She is studying for her history {it}test{/it}.' }, { t: 'a second example' }]],
                ],
              },
            ],
            ['bs', { sense: { dt: [['text', '{bc}a {sx|trial||} of something']] } }],
          ],
          [['pseq', [['sense', { dt: [['text', '{bc}something nested']] }]]]],
          [['sense', { dt: [['vis', [{ t: 'an example without a definition' }]]] }]],
        ],
      },
    ],
    shortdef: ['a set of questions'],
  },
  {
    meta: { id: 'test:2' },
    hwi: { hw: 'test' },
    fl: 'verb',
    shortdef: ['{bc}to use something in order to see if it works'],
  },
];

const fakeFetch = (body: unknown, status = 200) => {
  const calls: string[] = [];
  const fetch = (async (url: string) => {
    calls.push(url);
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
};

test('lookup maps every sense of every entry to the word fields', async () => {
  const { fetch, calls } = fakeFetch(TEST_ENTRIES);
  const { senses, suggestions } = await lookupWord(' test ', { apiKey: 'k&y', fetch });

  assert.equal(calls[0], 'https://www.dictionaryapi.com/api/v3/references/learners/json/test?key=k%26y');
  assert.deepEqual(suggestions, []);
  assert.deepEqual(senses, [
    {
      foreign: 'test',
      pronunciation: '/ˈtɛst/',
      lexicalCategory: 'noun',
      audio: 'https://media.merriam-webster.com/audio/prons/en/us/mp3/t/test0001.mp3',
      definition: "a set of questions or problems that are designed to measure a person's knowledge",
      example: 'She is studying for her history test.',
    },
    {
      foreign: 'test',
      pronunciation: '/ˈtɛst/',
      lexicalCategory: 'noun',
      audio: 'https://media.merriam-webster.com/audio/prons/en/us/mp3/t/test0001.mp3',
      definition: 'a trial of something',
      example: null,
    },
    {
      foreign: 'test',
      pronunciation: '/ˈtɛst/',
      lexicalCategory: 'noun',
      audio: 'https://media.merriam-webster.com/audio/prons/en/us/mp3/t/test0001.mp3',
      definition: 'something nested',
      example: null,
    },
    {
      foreign: 'test',
      pronunciation: null,
      lexicalCategory: 'verb',
      audio: null,
      definition: 'to use something in order to see if it works',
      example: null,
    },
  ]);
});

test('lookup returns suggestions when the dictionary has no entry', async () => {
  const { fetch } = fakeFetch(['tested', 'testy', 'tester']);
  assert.deepEqual(await lookupWord('testt', { apiKey: 'key', fetch }), {
    senses: [],
    suggestions: ['tested', 'testy', 'tester'],
  });
});

test('lookup fails with a DictionaryError on HTTP errors and odd responses', async () => {
  await assert.rejects(lookupWord('test', { apiKey: 'key', ...fakeFetch('Invalid API key', 403) }), DictionaryError);
  await assert.rejects(lookupWord('test', { apiKey: 'key', ...fakeFetch({ not: 'a list' }) }), DictionaryError);
  const failing = (async () => {
    throw new TypeError('fetch failed');
  }) as unknown as typeof fetch;
  await assert.rejects(lookupWord('test', { apiKey: 'key', fetch: failing }), DictionaryError);
});

/** What the API answers to a key without Learner's access: HTTP 200 with plain text. */
const rejectedKeyFetch = (async () =>
  new Response('Invalid API key. Not subscribed for this reference.', { status: 200 })) as unknown as typeof fetch;

test('a rejected API key is told apart from other failures', async () => {
  await assert.rejects(lookupWord('test', { apiKey: 'key', fetch: rejectedKeyFetch }), DictionaryKeyError);
  const html = (async () => new Response('<html>Bad gateway</html>', { status: 200 })) as unknown as typeof fetch;
  await assert.rejects(lookupWord('test', { apiKey: 'key', fetch: html }), (err) =>
    err instanceof DictionaryError && !(err instanceof DictionaryKeyError),
  );
});

test('headword syllable marks are removed and senses are capped', async () => {
  const many = Array.from({ length: 20 }, (_, i) => [['sense', { dt: [['text', `{bc}meaning ${i}`]] }]]);
  const { fetch } = fakeFetch([{ hwi: { hw: 'in*ter*est' }, fl: 'noun', def: [{ sseq: many }] }]);
  const { senses } = await lookupWord('interest', { apiKey: 'key', fetch });
  assert.equal(senses.length, 15);
  assert.equal(senses[0].foreign, 'interest');
});

test('audio files are found in the subdirectory the API documents', () => {
  const dir = (name: string) => audioUrl(name).split('/').at(-2);
  assert.equal(dir('bixtest01'), 'bix');
  assert.equal(dir('ggtest01'), 'gg');
  assert.equal(dir('3d000001'), 'number');
  assert.equal(dir('_test001'), 'number');
  assert.equal(dir('Test0001'), 't');
});

test('markup is reduced to plain text', () => {
  assert.equal(cleanMarkup('{bc}a {it}big{/it} {sx|house||} {ldquo}here{rdquo} .'), 'a big house “here”.');
  assert.equal(cleanMarkup('{bc}to run {dx}see also {dxt|race||}{/dx}'), 'to run');
  assert.equal(cleanMarkup('{phrase}take a test{/phrase} {a_link|exam} {d_link|quiz|quiz:1}'), 'take a test exam quiz');
});

test('the dictionary route needs an API key', async () => {
  const { app } = await testApp();
  const { headers } = await registerUser(app);
  const res = await app.inject({ method: 'GET', url: '/api/words/dictionary?q=test', headers });
  assert.equal(res.statusCode, 503);
});

test('the dictionary route returns senses, and 502 when the dictionary fails', async () => {
  const ok = await testApp({ apiKey: 'key', ...fakeFetch(TEST_ENTRIES) });
  const alice = await registerUser(ok.app);
  const res = await ok.app.inject({ method: 'GET', url: '/api/words/dictionary?q=test', headers: alice.headers });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().senses.length, 4);

  const anonymous = await ok.app.inject({ method: 'GET', url: '/api/words/dictionary?q=test' });
  assert.equal(anonymous.statusCode, 401);

  const down = await testApp({ apiKey: 'key', ...fakeFetch('oops', 500) });
  const bob = await registerUser(down.app);
  const failed = await down.app.inject({ method: 'GET', url: '/api/words/dictionary?q=test', headers: bob.headers });
  assert.equal(failed.statusCode, 502);

  const rejected = await testApp({ apiKey: 'key', fetch: rejectedKeyFetch });
  const carol = await registerUser(rejected.app, 'carol');
  const res503 = await rejected.app.inject({ method: 'GET', url: '/api/words/dictionary?q=test', headers: carol.headers });
  assert.equal(res503.statusCode, 503);
  assert.match(res503.json().error, /rejected the API key/);
});
