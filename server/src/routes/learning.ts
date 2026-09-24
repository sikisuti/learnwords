import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../auth/session.ts';
import type { Db } from '../db/connection.ts';
import { buildDeck, completeDeck, userStats, type Completion } from '../services/deck.ts';

const idList = { type: 'array', maxItems: 100, uniqueItems: true, items: { type: 'integer', minimum: 1 } };

export function learningRoutes(app: FastifyInstance, db: Db) {
  app.addHook('preHandler', requireAuth);

  app.get('/stats', async (request) => userStats(db, request.user!.id));

  app.patch<{ Body: { sessionSize: number } }>(
    '/settings',
    {
      schema: {
        body: {
          type: 'object',
          required: ['sessionSize'],
          additionalProperties: false,
          properties: { sessionSize: { type: 'integer', minimum: 1, maximum: 50 } },
        },
      },
    },
    async (request) => {
      db.prepare('UPDATE user SET session_size = ? WHERE id = ?').run(request.body.sessionSize, request.user!.id);
      return { ...request.user!, sessionSize: request.body.sessionSize };
    },
  );

  app.post('/sessions', async (request) => buildDeck(db, request.user!.id, request.user!.sessionSize));

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
}
