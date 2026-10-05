import { join, resolve } from 'node:path';
import pretty from 'pino-pretty';
import { buildApp } from './app.ts';
import { openDatabase } from './db/connection.ts';

const dataDir = resolve(process.env.DATA_DIR ?? 'data');
const publicDir = resolve(process.env.PUBLIC_DIR ?? 'public');
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';
const logLevel = process.env.LOG_LEVEL ?? 'info';

// Readable lines by default; LOG_FORMAT=json keeps pino's JSON for log tooling. Formatting runs in this thread
// (no transport worker), and colours only appear on a terminal, not in the systemd journal.
const logger =
  process.env.LOG_FORMAT === 'json'
    ? { level: logLevel }
    : {
        level: logLevel,
        stream: pretty({
          sync: true,
          colorize: !!process.stdout.isTTY,
          translateTime: 'SYS:HH:MM:ss.l',
          ignore: 'pid,hostname,reqId',
        }),
      };

const db = openDatabase(join(dataDir, 'learnwords.db'));
const app = await buildApp({
  db,
  publicDir,
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  logger,
  dictionary: { apiKey: process.env.MW_LEARNERS_API_KEY },
});

const shutdown = async () => {
  await app.close();
  db.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port, host });
