import { buildApp } from '../src/app.ts';
import { openDatabase, type Db } from '../src/db/connection.ts';

export async function testApp() {
  const db = openDatabase(':memory:');
  const app = await buildApp({ db });
  return { db, app };
}

type App = Awaited<ReturnType<typeof testApp>>['app'];

/** Registers a user and returns a cookie header for authenticated requests. */
export async function registerUser(app: App, username = 'alice', password = 'secret-password') {
  const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username, password } });
  if (res.statusCode !== 201) throw new Error(`register failed: ${res.body}`);
  const cookie = res.cookies.find((c) => c.name === 'lw_session')!;
  return { id: res.json().id as number, headers: { cookie: `${cookie.name}=${cookie.value}` } };
}

/** Inserts a dictionary word (not linked to any user) unless it exists; level ids: 1 = A1 … 6 = C2, 7 = unlevelled. */
export function seedWord(db: Db, foreign: string, levelId = 7): number {
  const existing = db.prepare('SELECT id FROM word WHERE foreign_norm = ?').get(foreign.toLowerCase()) as
    | { id: number }
    | undefined;
  return (
    existing?.id ??
    Number(
      db
        .prepare(`INSERT INTO word (native, "foreign", foreign_norm, level_id, created_at) VALUES (?, ?, ?, ?, ?)`)
        .run(`native ${foreign}`, foreign, foreign.toLowerCase(), levelId, new Date().toISOString()).lastInsertRowid,
    )
  );
}

/** Inserts a dictionary word and links it to the user with the given stage and last_learned time. */
export function seedUserWord(
  db: Db,
  userId: number,
  foreign: string,
  stage: number,
  lastLearned: Date,
  autoAdded = false,
): number {
  const wordId = seedWord(db, foreign);
  db.prepare('INSERT INTO user_word (user_id, word_id, stage, last_learned, auto_added) VALUES (?, ?, ?, ?, ?)').run(
    userId,
    wordId,
    stage,
    lastLearned.toISOString(),
    autoAdded ? 1 : 0,
  );
  return wordId;
}

export const daysAgo = (days: number, from = new Date()) => new Date(from.getTime() - days * 24 * 60 * 60 * 1000);
