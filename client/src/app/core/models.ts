export interface User {
  id: number;
  username: string;
  sessionSize: number;
}

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
}

export interface WordInput {
  native: string;
  foreign: string;
  definition?: string | null;
  example?: string | null;
  pronunciation?: string | null;
  level?: string | null;
  lexicalCategory?: string | null;
}

export interface SearchHit extends Word {
  /** the user's stage for this word, or null if it is not on their list */
  stage: number | null;
}

export interface AddResult {
  word: Word;
  created: boolean;
  previousStage: number | null;
}

export interface DeckWord extends Word {
  stage: number;
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
