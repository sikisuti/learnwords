import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../auth/session.ts';
import type { Db } from '../db/connection.ts';
import { DictionaryError, DictionaryKeyError, lookupWord, type DictionaryOptions } from '../services/dictionary.ts';
import { addOrLinkWord, linkExistingWord, listLevels, searchWords, type WordInput } from '../services/words.ts';

const optionalText = { type: ['string', 'null'], maxLength: 2000 };

const wordSchema = {
  body: {
    type: 'object',
    required: ['native', 'foreign'],
    additionalProperties: false,
    properties: {
      native: { type: 'string', minLength: 1, maxLength: 500, pattern: '\\S' },
      foreign: { type: 'string', minLength: 1, maxLength: 500, pattern: '\\S' },
      definition: optionalText,
      example: optionalText,
      pronunciation: optionalText,
      level: { type: ['string', 'null'], enum: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', '?', '', null] },
      lexicalCategory: { type: ['string', 'null'], maxLength: 100 },
      audio: { type: ['string', 'null'], maxLength: 500, pattern: '^https://' },
    },
  },
} as const;

const queryString = {
  querystring: { type: 'object', required: ['q'], properties: { q: { type: 'string', maxLength: 200 } } },
} as const;

export function wordRoutes(app: FastifyInstance, db: Db, dictionary: DictionaryOptions = {}) {
  app.addHook('preHandler', requireAuth);

  app.get('/levels', async () => listLevels(db));

  app.get<{ Querystring: { q: string } }>(
    '/words/search',
    { schema: queryString },
    async (request) => searchWords(db, request.user!.id, request.query.q),
  );

  app.get<{ Querystring: { q: string } }>(
    '/words/dictionary',
    // The free API key allows 1000 lookups a day.
    { schema: queryString, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request, reply) => {
      if (!dictionary.apiKey) return reply.code(503).send({ error: 'Dictionary lookup is not configured.' });
      try {
        return await lookupWord(request.query.q, dictionary);
      } catch (err) {
        if (!(err instanceof DictionaryError)) throw err;
        request.log.warn({ err }, 'dictionary lookup failed');
        if (err instanceof DictionaryKeyError) {
          return reply.code(503).send({ error: 'The dictionary rejected the API key. Check that it is a Learner’s Dictionary key.' });
        }
        return reply.code(502).send({ error: 'The dictionary could not be reached. Try again later.' });
      }
    },
  );

  app.post<{ Body: WordInput }>('/words', { schema: wordSchema }, async (request, reply) => {
    const result = addOrLinkWord(db, request.user!.id, request.body);
    return reply.code(result.created ? 201 : 200).send(result);
  });

  app.post<{ Params: { id: number } }>(
    '/words/:id/learn',
    { schema: { params: { type: 'object', properties: { id: { type: 'integer', minimum: 1 } } } } },
    async (request, reply) => {
      const result = linkExistingWord(db, request.user!.id, request.params.id);
      if (!result) return reply.code(404).send({ error: 'Word not found' });
      return result;
    },
  );
}
