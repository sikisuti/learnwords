/**
 * Imports dictionary words from a CSV or JSON file into the global word table.
 *
 *   npm run import -- words.csv [--update] [--db path/to/learnwords.db]
 *
 * CSV: header row with columns native, foreign, definition, example, pronunciation, level, lexical_category
 *      (only native and foreign are required; level is A1..C2 or empty).
 * JSON: an array of objects with the same keys (lexicalCategory is accepted too).
 * Words whose foreign text already exists are skipped, or overwritten with --update.
 * Imported words are not put on any user's list; users pick them up via search on the Add word screen.
 */
import { readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { parse } from 'csv-parse/sync';
import { openDatabase, transaction } from '../src/db/connection.ts';
import { importWord, type ImportOutcome, type WordInput } from '../src/services/words.ts';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    update: { type: 'boolean', default: false },
    db: { type: 'string', default: join(process.env.DATA_DIR ?? 'data', 'learnwords.db') },
  },
});

const file = positionals[0];
if (!file) {
  console.error('Usage: npm run import -- <words.csv|words.json> [--update] [--db <path>]');
  process.exit(1);
}

type Row = Record<string, unknown>;
const text = readFileSync(resolve(file), 'utf8');
const rows: Row[] =
  extname(file).toLowerCase() === '.json'
    ? JSON.parse(text)
    : parse(text, { columns: true, bom: true, skip_empty_lines: true, trim: true });

const str = (value: unknown) => (value == null ? null : String(value));

const db = openDatabase(resolve(values.db));
const counts: Record<ImportOutcome | 'invalid', number> = { inserted: 0, updated: 0, skipped: 0, invalid: 0 };

transaction(db, () => {
  rows.forEach((row, index) => {
    const input: WordInput = {
      native: str(row.native) ?? '',
      foreign: str(row.foreign) ?? '',
      definition: str(row.definition),
      example: str(row.example),
      pronunciation: str(row.pronunciation),
      level: str(row.level),
      lexicalCategory: str(row.lexical_category ?? row.lexicalCategory),
    };
    if (!input.native.trim() || !input.foreign.trim()) {
      console.warn(`Row ${index + 1}: native and foreign are required, skipped`);
      counts.invalid++;
      return;
    }
    try {
      counts[importWord(db, input, values.update)]++;
    } catch (err) {
      console.warn(`Row ${index + 1}: ${(err as Error).message}, skipped`);
      counts.invalid++;
    }
  });
});
db.close();

console.log(
  `Inserted ${counts.inserted}, updated ${counts.updated}, skipped ${counts.skipped} existing, ${counts.invalid} invalid.`,
);
