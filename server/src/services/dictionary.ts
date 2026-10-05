/**
 * Word lookup in the Merriam-Webster Learner's Dictionary API
 * (https://www.dictionaryapi.com/products/api-learners-dictionary), mapped to the fields of a word.
 */

const API_URL = 'https://www.dictionaryapi.com/api/v3/references/learners/json/';
const AUDIO_URL = 'https://media.merriam-webster.com/audio/prons/en/us/mp3/';
const TIMEOUT_MS = 8000;
const MAX_SENSES = 15;
const MAX_SUGGESTIONS = 8;

/** One meaning of a dictionary entry, ready to fill the add-word form. */
export interface DictionarySense {
  foreign: string;
  definition: string | null;
  example: string | null;
  pronunciation: string | null;
  lexicalCategory: string | null;
  audio: string | null;
}

export interface LookupResult {
  senses: DictionarySense[];
  /** similar words the dictionary offers when it has no entry for the query */
  suggestions: string[];
}

export interface DictionaryOptions {
  apiKey?: string;
  fetch?: typeof fetch;
}

/** The dictionary could not be reached or answered with something unexpected. */
export class DictionaryError extends Error {}

/** The dictionary refused the API key, e.g. one registered for a different Merriam-Webster reference. */
export class DictionaryKeyError extends DictionaryError {}

export async function lookupWord(query: string, { apiKey, fetch = globalThis.fetch }: DictionaryOptions): Promise<LookupResult> {
  const q = query.trim();
  if (!q) return { senses: [], suggestions: [] };

  let text: string;
  try {
    const res = await fetch(`${API_URL}${encodeURIComponent(q)}?key=${encodeURIComponent(apiKey ?? '')}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new DictionaryError(`Dictionary responded with HTTP ${res.status}`);
    text = await res.text();
  } catch (err) {
    throw err instanceof DictionaryError ? err : new DictionaryError('Dictionary request failed', { cause: err });
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    // A bad key gets HTTP 200 with a plain-text message: "Invalid API key. Not subscribed for this reference."
    const message = text.trim().slice(0, 200);
    if (/api key/i.test(message)) throw new DictionaryKeyError(`Dictionary rejected the API key: ${message}`);
    throw new DictionaryError(`Dictionary answered with something other than JSON: ${message}`);
  }
  if (!Array.isArray(body)) throw new DictionaryError('Unexpected dictionary response');

  // No entry: the API answers with a list of similar words instead.
  if (body.every((item) => typeof item === 'string')) {
    return { senses: [], suggestions: (body as string[]).slice(0, MAX_SUGGESTIONS) };
  }

  const senses: DictionarySense[] = [];
  for (const entry of body) {
    if (senses.length >= MAX_SENSES) break;
    if (entry && typeof entry === 'object') senses.push(...entrySenses(entry as Entry).slice(0, MAX_SENSES - senses.length));
  }
  return { senses, suggestions: [] };
}

interface Pronunciation {
  ipa?: string;
  mw?: string;
  sound?: { audio?: string };
}

interface Entry {
  hwi?: { hw?: string; prs?: Pronunciation[] };
  fl?: string;
  def?: { sseq?: unknown[] }[];
  shortdef?: string[];
}

function entrySenses(entry: Entry): DictionarySense[] {
  const foreign = entry.hwi?.hw?.replaceAll('*', '').trim();
  if (!foreign) return [];
  const prs = entry.hwi?.prs ?? [];
  const ipa = prs.find((p) => p.ipa || p.mw);
  const sound = prs.find((p) => p.sound?.audio)?.sound?.audio;
  const base = {
    foreign,
    pronunciation: ipa ? `/${ipa.ipa ?? ipa.mw}/` : null,
    lexicalCategory: entry.fl?.trim() || null,
    audio: sound ? audioUrl(sound) : null,
  };

  const senses = (entry.def ?? [])
    .flatMap((d) => senseObjects(d.sseq ?? []))
    .map((sense) => ({ ...base, ...senseText(sense.dt ?? []) }))
    .filter((sense) => sense.definition);
  if (senses.length) return senses;

  const shortdef = cleanMarkup(entry.shortdef?.[0] ?? '');
  return [{ ...base, definition: shortdef || null, example: null }];
}

interface Sense {
  dt?: unknown[];
  sense?: Sense;
}

/** The sense objects in a sense sequence, which nests them as ["sense", {...}], ["bs", { sense }] and ["pseq", [...]]. */
function senseObjects(sseq: unknown[]): Sense[] {
  const found: Sense[] = [];
  const walk = (node: unknown) => {
    if (!Array.isArray(node)) return;
    const [label, value] = node;
    if (label === 'sense' && value && typeof value === 'object') found.push(value as Sense);
    else if (label === 'bs' && (value as Sense)?.sense) found.push((value as Sense).sense!);
    else node.forEach(walk);
  };
  sseq.forEach(walk);
  return found;
}

/** Definition and first example from a sense's defining text: [["text", "{bc}…"], ["vis", [{ t: "…" }]], …]. */
function senseText(dt: unknown[]): { definition: string | null; example: string | null } {
  const texts: string[] = [];
  let example: string | null = null;
  for (const item of dt) {
    if (!Array.isArray(item)) continue;
    const [type, value] = item;
    if (type === 'text' && typeof value === 'string') texts.push(value);
    else if (type === 'vis' && example === null && Array.isArray(value) && typeof value[0]?.t === 'string') {
      example = cleanMarkup(value[0].t) || null;
    }
  }
  return { definition: cleanMarkup(texts.join(' ')) || null, example };
}

/** Public URL of a pronunciation mp3, following the subdirectory rules of the API documentation. */
export function audioUrl(name: string): string {
  const subdirectory = name.startsWith('bix')
    ? 'bix'
    : name.startsWith('gg')
      ? 'gg'
      : /^[^a-z]/i.test(name)
        ? 'number'
        : name[0].toLowerCase();
  return `${AUDIO_URL}${subdirectory}/${encodeURIComponent(name)}.mp3`;
}

/** Plain text from the API's {token} markup. */
export function cleanMarkup(text: string): string {
  return (
    text
      .replace(/\{ldquo\}/g, '“')
      .replace(/\{rdquo\}/g, '”')
      // Cross-references whose text is not part of the sentence: {dx}see also {dxt|…||}{/dx}
      .replace(/\{dx\}.*?\{\/dx\}/g, '')
      // Links keep their first field: {sx|word||}, {a_link|word}, {d_link|word|id}, {dxt|word||}, …
      .replace(/\{[a-z_]+\|([^|}]*)[^}]*\}/g, '$1')
      // Everything else ({bc}, {it}…{/it}, {phrase}…{/phrase}, …) is formatting only.
      .replace(/\{[^}]*\}/g, ' ')
      .replace(/\s+([,.;:!?)])/g, '$1')
      .replace(/\s+/g, ' ')
      .trim()
  );
}
