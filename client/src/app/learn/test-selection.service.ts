import { Injectable, signal } from '@angular/core';
import type { DeckWord } from '../core/models';

/** Hands the words picked on the test selection page to the test page. Not persisted. */
@Injectable({ providedIn: 'root' })
export class TestSelectionService {
  readonly words = signal<DeckWord[]>([]);
}
