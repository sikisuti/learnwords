import { join, resolve } from 'node:path';
import { buildApp } from './app.ts';
import { openDatabase } from './db/connection.ts';

const dataDir = resolve(process.env.DATA_DIR ?? 'data');
const publicDir = resolve(process.env.PUBLIC_DIR ?? 'public');
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';

const db = openDatabase(join(dataDir, 'learnwords.db'));
const app = await buildApp({
  db,
  publicDir,
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
});

const shutdown = async () => {
  await app.close();
  db.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port, host });
