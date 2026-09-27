import type { FastifyInstance } from 'fastify';
import { getSessionUser, requireAuth } from '../auth/session.ts';
import type { Db } from '../db/connection.ts';
import { buildDeck, completeDeck, markKnown, randomSessionSize, userStats, type Completion } from '../services/deck.ts';

const idList = { type: 'array', maxItems: 100, uniqueItems: true, items: { type: 'integer', minimum: 1 } };

export function learningRoutes(app: FastifyInstance, db: Db) {
  app.addHook('preHandler', requireAuth);

  app.get('/stats', async (request) => userStats(db, request.user!.id));

  app.patch<{ Body: { sessionSize: number; fillWithNewWords: boolean } }>(
    '/settings',
    {
      schema: {
        body: {
          type: 'object',
          required: ['sessionSize', 'fillWithNewWords'],
          additionalProperties: false,
          properties: {
            sessionSize: { type: 'integer', minimum: 1, maximum: 50 },
            fillWithNewWords: { type: 'boolean' },
          },
        },
      },
    },
    async (request) => {
      const { sessionSize, fillWithNewWords } = request.body;
      db.prepare('UPDATE user_configuration SET session_size = ?, fill_with_new_words = ? WHERE user_id = ?').run(
        sessionSize,
        fillWithNewWords ? 1 : 0,
        request.user!.id,
      );
      return getSessionUser(db, request.user!.id);
    },
  );

  app.post('/sessions', async (request) => {
    const { id, sessionSize, fillWithNewWords } = request.user!;
    return buildDeck(db, id, { sessionSize: randomSessionSize(sessionSize), fillWithNewWords });
  });

  app.post<{ Body: Completion }>(
    '/sessions/complete',
    {
      schema: {
        body: {
          type: 'object',
          required: ['issuedAt', 'learnIds', 'knownIds'],
          additionalProperties: false,
          properties: { issuedAt: { type: 'string', format: 'date-time' }, learnIds: idList, knownIds: idList },
        },
      },
    },
    // Normalize issuedAt so it compares correctly with the stored ISO strings.
    async (request) =>
      completeDeck(db, request.user!.id, { ...request.body, issuedAt: new Date(request.body.issuedAt).toISOString() }),
  );

  app.post<{ Params: { id: number } }>(
    '/words/:id/known',
    { schema: { params: { type: 'object', properties: { id: { type: 'integer', minimum: 1 } } } } },
    async (request, reply) => {
      const result = markKnown(db, request.user!.id, request.params.id);
      if (result === 'not-found') return reply.code(404).send({ error: 'Word not found' });
      if (result === 'not-auto-added') {
        return reply.code(409).send({ error: 'Only auto-added words can be marked as known' });
      }
      return reply.code(204).send();
    },
  );
}
