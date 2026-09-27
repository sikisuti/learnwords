import type { FastifyInstance, FastifyReply } from 'fastify';
import { hashPassword, verifyPassword } from '../auth/password.ts';
import { SESSION_COOKIE, createSession, deleteSession, getSessionUser, requireAuth } from '../auth/session.ts';
import { transaction, type Db } from '../db/connection.ts';

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

interface PasswordChange {
  currentPassword: string;
  newPassword: string;
}

const passwordChangeSchema = {
  body: {
    type: 'object',
    required: ['currentPassword', 'newPassword'],
    additionalProperties: false,
    properties: {
      currentPassword: { type: 'string' },
      newPassword: { type: 'string' },
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
    const id = transaction(db, () => {
      const result = db
        .prepare('INSERT INTO user (username, password_hash, created_at) VALUES (?, ?, ?)')
        .run(username, hash, new Date().toISOString());
      const userId = Number(result.lastInsertRowid);
      db.prepare('INSERT INTO user_configuration (user_id) VALUES (?)').run(userId);
      return userId;
    });
    startSession(reply, id);
    return reply.code(201).send(getSessionUser(db, id));
  });

  app.post<{ Body: Credentials }>('/auth/login', { schema: credentialsSchema, ...rateLimit }, async (request, reply) => {
    const { username, password } = request.body;
    const row = db.prepare('SELECT id, password_hash AS hash FROM user WHERE username = ?').get(username) as
      | { id: number; hash: string }
      | undefined;
    const ok = await verifyPassword(password, row?.hash ?? (await dummyHash));
    if (!row || !ok) return reply.code(401).send({ error: 'Wrong username or password' });
    startSession(reply, row.id);
    return getSessionUser(db, row.id);
  });

  app.post('/auth/logout', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) deleteSession(db, token);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.code(204).send();
  });

  app.get('/auth/me', { preHandler: requireAuth }, async (request) => request.user);

  app.post<{ Body: PasswordChange }>(
    '/auth/password',
    { schema: passwordChangeSchema, preHandler: requireAuth, ...rateLimit },
    async (request, reply) => {
      const { currentPassword, newPassword } = request.body;
      const userId = request.user!.id;
      const { hash } = db.prepare('SELECT password_hash AS hash FROM user WHERE id = ?').get(userId) as { hash: string };
      if (!(await verifyPassword(currentPassword, hash))) {
        return reply.code(403).send({ error: 'The current password is wrong' });
      }
      const newHash = await hashPassword(newPassword);
      transaction(db, () => {
        db.prepare('UPDATE user SET password_hash = ? WHERE id = ?').run(newHash, userId);
        // Other devices have to log in again with the new password; this one gets a fresh session.
        db.prepare('DELETE FROM session WHERE user_id = ?').run(userId);
      });
      startSession(reply, userId);
      return reply.code(204).send();
    },
  );
}
