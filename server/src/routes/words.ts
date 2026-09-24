import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../auth/session.ts';
import type { Db } from '../db/connection.ts';
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
    },
  },
} as const;

export function wordRoutes(app: FastifyInstance, db: Db) {
  app.addHook('preHandler', requireAuth);

  app.get('/levels', async () => listLevels(db));

  app.get<{ Querystring: { q: string } }>(
    '/words/search',
    { schema: { querystring: { type: 'object', required: ['q'], properties: { q: { type: 'string', maxLength: 200 } } } } },
    async (request) => searchWords(db, request.user!.id, request.query.q),
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
