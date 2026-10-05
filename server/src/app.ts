import { existsSync } from 'node:fs';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { LogController, type FastifyServerOptions } from 'fastify';
import { SESSION_COOKIE, findSessionUser } from './auth/session.ts';
import type { Db } from './db/connection.ts';
import { authRoutes } from './routes/auth.ts';
import { learningRoutes } from './routes/learning.ts';
import { wordRoutes } from './routes/words.ts';
import type { DictionaryOptions } from './services/dictionary.ts';

export interface AppOptions {
  db: Db;
  /** Set the Secure flag on the session cookie (enable when served over HTTPS). */
  cookieSecure?: boolean;
  /** Directory of the built Angular app; skipped when missing (e.g. in tests or during `ng serve` development). */
  publicDir?: string;
  logger?: FastifyServerOptions['logger'];
  /** Merriam-Webster Learner's Dictionary API access; word lookup answers 503 without an API key. */
  dictionary?: DictionaryOptions;
}

export async function buildApp({ db, cookieSecure = false, publicDir, logger = false, dictionary }: AppOptions) {
  // One line per request (logged below) instead of Fastify's "incoming request" and "request completed" pair.
  const app = Fastify({
    logger,
    trustProxy: true,
    logController: new LogController({ disableRequestLogging: true }),
  });

  await app.register(cookie);
  await app.register(rateLimit, { global: false });

  app.addHook('onResponse', async (request, reply) => {
    request.log.info(`${request.method} ${request.url} → ${reply.statusCode} (${Math.round(reply.elapsedTime)} ms)`);
  });

  app.decorateRequest('user', null);
  app.addHook('onRequest', async (request) => {
    const token = request.cookies[SESSION_COOKIE];
    request.user = token ? findSessionUser(db, token) : null;
  });

  // Also proves the database is readable; the deploy script waits for this after a restart.
  app.get('/health', async () => {
    db.prepare('SELECT 1').get();
    return { ok: true };
  });

  await app.register(
    async (api) => {
      await api.register(async (scope) => authRoutes(scope, db, cookieSecure));
      await api.register(async (scope) => wordRoutes(scope, db, dictionary));
      await api.register(async (scope) => learningRoutes(scope, db));
    },
    { prefix: '/api' },
  );

  if (publicDir && existsSync(publicDir)) {
    await app.register(fastifyStatic, { root: publicDir, wildcard: false, preCompressed: true });
    // Client-side routes (/learn, /add, ...) all load the Angular app.
    app.setNotFoundHandler((request, reply) => {
      if (request.method !== 'GET' || request.url.startsWith('/api/')) {
        return reply.code(404).send({ error: 'Not found' });
      }
      return reply.sendFile('index.html');
    });
  }

  return app;
}
