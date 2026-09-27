import { createHash, randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from '../db/connection.ts';

export const SESSION_COOKIE = 'lw_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface SessionUser {
  id: number;
  username: string;
  sessionSize: number;
  /** when the user's own due words leave free slots in a deck, fill them with dictionary words new to the user */
  fillWithNewWords: boolean;
}

const SESSION_USER_QUERY = `SELECT u.id, u.username, c.session_size AS sessionSize, c.fill_with_new_words AS fillWithNewWords
  FROM user u JOIN user_configuration c ON c.user_id = u.id`;

type SessionUserRow = Omit<SessionUser, 'fillWithNewWords'> & { fillWithNewWords: number };

const toSessionUser = (row: SessionUserRow | undefined): SessionUser | null =>
  row ? { ...row, fillWithNewWords: row.fillWithNewWords === 1 } : null;

export function getSessionUser(db: Db, userId: number): SessionUser | null {
  return toSessionUser(db.prepare(`${SESSION_USER_QUERY} WHERE u.id = ?`).get(userId) as SessionUserRow | undefined);
}

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
  }
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('base64url');

export function createSession(db: Db, userId: number, now = new Date()): { token: string; expiresAt: Date } {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  db.prepare('DELETE FROM session WHERE expires_at < ?').run(now.toISOString());
  db.prepare('INSERT INTO session (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(
    hashToken(token),
    userId,
    expiresAt.toISOString(),
  );
  return { token, expiresAt };
}

export function findSessionUser(db: Db, token: string, now = new Date()): SessionUser | null {
  const row = db
    .prepare(`${SESSION_USER_QUERY} JOIN session s ON s.user_id = u.id WHERE s.token_hash = ? AND s.expires_at > ?`)
    .get(hashToken(token), now.toISOString()) as SessionUserRow | undefined;
  return toSessionUser(row);
}

export function deleteSession(db: Db, token: string): void {
  db.prepare('DELETE FROM session WHERE token_hash = ?').run(hashToken(token));
}

/** preHandler that rejects requests without a valid session. */
export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.user) await reply.code(401).send({ error: 'Not logged in' });
}
