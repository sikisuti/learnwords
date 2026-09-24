import { createHash, randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from '../db/connection.ts';

export const SESSION_COOKIE = 'lw_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface SessionUser {
  id: number;
  username: string;
  sessionSize: number;
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
    .prepare(
      `SELECT u.id, u.username, u.session_size AS sessionSize
         FROM session s JOIN user u ON u.id = s.user_id
        WHERE s.token_hash = ? AND s.expires_at > ?`,
    )
    .get(hashToken(token), now.toISOString()) as SessionUser | undefined;
  return row ? { ...row } : null;
}

export function deleteSession(db: Db, token: string): void {
  db.prepare('DELETE FROM session WHERE token_hash = ?').run(hashToken(token));
}

/** preHandler that rejects requests without a valid session. */
export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.user) await reply.code(401).send({ error: 'Not logged in' });
}
