export interface User {
  id: number;
  username: string;
  sessionSize: number;
  fillWithNewWords: boolean;
}

export type Settings = Pick<User, 'sessionSize' | 'fillWithNewWords'>;

export interface Level {
  id: number;
  code: string;
  name: string;
}

export interface Word {
  id: number;
  native: string;
  foreign: string;
  definition: string | null;
  example: string | null;
  pronunciation: string | null;
  level: string;
  lexicalCategory: string | null;
  /** URL of a pronunciation recording (mp3), if any */
  audio: string | null;
}

export interface WordInput {
  native: string;
  foreign: string;
  definition?: string | null;
  example?: string | null;
  pronunciation?: string | null;
  level?: string | null;
  lexicalCategory?: string | null;
  audio?: string | null;
}

export interface SearchHit extends Word {
  /** the user's stage for this word, or null if it is not on their list */
  stage: number | null;
}

/** One meaning of a word found in the external dictionary. */
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

export interface AddResult {
  word: Word;
  created: boolean;
  /** an existing word without a definition was given this definition */
  filled: boolean;
  previousStage: number | null;
}

export interface DeckWord extends Word {
  stage: number;
  /** put on the user's list by a deck filling its free slots, not by the user */
  autoAdded: boolean;
}

export interface Deck {
  issuedAt: string;
  learn: DeckWord[];
  known: DeckWord[];
}

export interface Stats {
  due: number;
  learning: number;
  known: number;
}
