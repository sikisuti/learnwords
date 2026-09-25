import type { FastifyInstance, FastifyReply } from 'fastify';
import { hashPassword, verifyPassword } from '../auth/password.ts';
import { SESSION_COOKIE, createSession, deleteSession, requireAuth, type SessionUser } from '../auth/session.ts';
import type { Db } from '../db/connection.ts';

interface Credentials {
  username: string;
  password: string;
}

const credentialsSchema = {
  body: {
    type: 'object',
    required: ['username', 'password'],
    additionalProperties: false,
    properties: {
      username: { type: 'string', minLength: 3, maxLength: 32, pattern: '^[\\p{L}\\p{N}._-]+$' },
      password: { type: 'string' },
    },
  },
} as const;

// Used when the username does not exist, so a failed login takes the same time either way.
const dummyHash = hashPassword('not-a-real-password');

export function authRoutes(app: FastifyInstance, db: Db, cookieSecure: boolean) {
  const startSession = (reply: FastifyReply, userId: number) => {
    const { token, expiresAt } = createSession(db, userId);
    reply.setCookie(SESSION_COOKIE, token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: cookieSecure,
      expires: expiresAt,
    });
  };
  const rateLimit = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

  app.post<{ Body: Credentials }>('/auth/register', { schema: credentialsSchema, ...rateLimit }, async (request, reply) => {
    const { username, password } = request.body;
    if (db.prepare('SELECT 1 FROM user WHERE username = ?').get(username)) {
      return reply.code(409).send({ error: 'This username is already taken' });
    }
    const hash = await hashPassword(password);
    const result = db
      .prepare('INSERT INTO user (username, password_hash, created_at) VALUES (?, ?, ?)')
      .run(username, hash, new Date().toISOString());
    const id = Number(result.lastInsertRowid);
    startSession(reply, id);
    return reply.code(201).send({ id, username, sessionSize: 5 } satisfies SessionUser);
  });

  app.post<{ Body: Credentials }>('/auth/login', { schema: credentialsSchema, ...rateLimit }, async (request, reply) => {
    const { username, password } = request.body;
    const row = db
      .prepare('SELECT id, username, password_hash AS hash, session_size AS sessionSize FROM user WHERE username = ?')
      .get(username) as (SessionUser & { hash: string }) | undefined;
    const ok = await verifyPassword(password, row?.hash ?? (await dummyHash));
    if (!row || !ok) return reply.code(401).send({ error: 'Wrong username or password' });
    startSession(reply, row.id);
    return { id: row.id, username: row.username, sessionSize: row.sessionSize } satisfies SessionUser;
  });

  app.post('/auth/logout', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) deleteSession(db, token);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.code(204).send();
  });

  app.get('/auth/me', { preHandler: requireAuth }, async (request) => request.user);
}
