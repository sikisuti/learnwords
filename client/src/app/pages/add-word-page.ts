import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService, errorMessage } from '../core/api.service';
import type { AddResult, DictionarySense, Level, SearchHit } from '../core/models';
import { ToastService } from '../core/toast.service';

const CATEGORIES = ['noun', 'verb', 'adjective', 'adverb', 'pronoun', 'preposition', 'conjunction', 'phrase', 'sentence'];

const normalize = (text: string) => text.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();

@Component({
  selector: 'app-add-word-page',
  imports: [ReactiveFormsModule, RouterLink],
  template: `
    <div class="page">
      <header class="topbar">
        <a class="btn icon" routerLink="/" aria-label="Back">←</a>
        <h1>Add a word</h1>
      </header>

      <form class="panel" [formGroup]="form" (ngSubmit)="submit()">
        <div class="field">
          <span><label for="foreign">Foreign</label></span>
          <div class="search">
            <input
              id="foreign"
              formControlName="foreign"
              autocomplete="off"
              autocapitalize="none"
              enterkeyhint="search"
              (keydown.enter)="$event.preventDefault(); search()"
            />
            <button type="button" class="btn" (click)="search()" [disabled]="lookingUp() || !foreign().trim()">
              {{ lookingUp() ? 'Searching…' : 'Search' }}
            </button>
          </div>
          <small>Search looks for the word in the database and in the Learner's Dictionary.</small>
        </div>

        @if (resultsOpen() && (hits().length || dictionary().length)) {
          <ul class="hits" aria-label="Matching words">
            @for (hit of hits(); track hit.id) {
              <li>
                <button type="button" class="hit" (click)="learn(hit)" [disabled]="busy()">
                  <span class="words">
                    <strong>{{ hit.foreign }} <span class="source db" title="Already in the database">DB</span></strong>
                    <span class="muted">{{ hit.native }}</span>
                    @if (hit.definition) {
                      <span class="muted definition">{{ hit.definition }}</span>
                    }
                  </span>
                  <span class="status">
                    @if (hit.level !== '?') {
                      <span class="level">{{ hit.level }}</span>
                    }
                    {{ hit.stage === null ? '＋ Learn' : hit.stage === 6 ? 'Known · relearn' : 'Stage ' + hit.stage + ' · restart' }}
                  </span>
                </button>
              </li>
            }
            @for (row of dictionaryRows(); track $index) {
              @let sense = row.sense;
              <li>
                <button
                  type="button"
                  class="hit"
                  [class.in-db]="row.inDatabase"
                  (click)="select(sense)"
                  [disabled]="busy() || row.inDatabase"
                  [attr.title]="row.inDatabase ? 'This meaning is already in the database; choose its DB row above.' : null"
                >
                  <span class="words">
                    <strong>
                      {{ sense.foreign }}
                      @if (sense.lexicalCategory) {
                        <span class="category">{{ sense.lexicalCategory }}</span>
                      }
                      <span class="source dict" title="From the Learner's Dictionary">Dictionary</span>
                    </strong>
                    <span class="muted definition">{{ sense.definition }}</span>
                  </span>
                  <span class="status">{{ row.inDatabase ? 'In DB' : 'Use' }}</span>
                </button>
              </li>
            }
          </ul>
        }

        @if (suggestions().length) {
          <div class="suggestions">
            <span class="muted">Not in the dictionary. Did you mean:</span>
            @for (word of suggestions(); track word) {
              <button type="button" class="chip" (click)="searchFor(word)">{{ word }}</button>
            }
          </div>
        } @else if (resultsOpen() && !dictionary().length && !lookupError()) {
          <p class="muted note">The dictionary has no entry for “{{ searchedFor() }}”.</p>
        }
        @if (lookupError()) {
          <p class="error" role="alert">{{ lookupError() }}</p>
        }

        @if (existing(); as existing) {
          <p class="muted note">
            @if (existing.fills) {
              “{{ existing.hit.foreign }}” is in the database without a definition. Saving gives it this one and adds it to your list.
            } @else {
              “{{ existing.hit.foreign }}” with this definition is already in the database. Saving adds it to your list.
            }
          </p>
        }

        <label class="field">
          <span>Native</span>
          <input formControlName="native" autocomplete="off" />
        </label>
        <label class="field">
          <span>Pronunciation <span class="muted">(optional)</span></span>
          <input formControlName="pronunciation" autocomplete="off" />
        </label>
        <label class="field">
          <span>Definition <span class="muted">(optional)</span></span>
          <textarea formControlName="definition" rows="2"></textarea>
        </label>
        <label class="field">
          <span>Example <span class="muted">(optional)</span></span>
          <textarea formControlName="example" rows="2"></textarea>
        </label>
        <div class="row">
          <label class="field">
            <span>Category</span>
            <input formControlName="lexicalCategory" list="categories" autocomplete="off" autocapitalize="none" />
            <datalist id="categories">
              @for (c of categories; track c) {
                <option [value]="c"></option>
              }
            </datalist>
          </label>
          <label class="field">
            <span>Level</span>
            <select formControlName="level">
              @for (level of levels(); track level.id) {
                <option [value]="level.code">{{ level.code === '?' ? 'Not set' : level.code + ' · ' + level.name }}</option>
              }
            </select>
          </label>
        </div>

        @if (error()) {
          <p class="error" role="alert">{{ error() }}</p>
        }
        <button class="btn primary block" type="submit" [disabled]="busy()">Save word</button>
      </form>
    </div>
  `,
  styles: `
    .search {
      display: flex;
      gap: 10px;
      input {
        flex: 1;
        min-width: 0;
      }
      .btn {
        flex: none;
        padding: 0 16px;
      }
    }
    .hits {
      list-style: none;
      margin: -4px 0 0;
      padding: 0;
      border: 3px solid var(--border);
      border-radius: var(--wobble-sm);
      overflow: hidden;
      li + li {
        border-top: 1px solid var(--border);
      }
    }
    .hit {
      display: flex;
      width: 100%;
      align-items: center;
      gap: 12px;
      min-height: 52px;
      padding: 8px 12px;
      border: 0;
      background: var(--surface-2);
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
      &.in-db {
        opacity: 0.55;
        cursor: default;
        .status {
          color: var(--muted);
        }
      }
    }
    .words .source {
      margin-left: 4px;
      padding: 0 6px;
      border-radius: 6px;
      color: var(--primary-text);
      font-size: 0.75rem;
      font-weight: 700;
      &.db {
        background: var(--mint);
      }
      &.dict {
        background: var(--lavender);
      }
    }
    .words {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-width: 0;
      span {
        font-size: 0.9rem;
      }
    }
    .category {
      margin-left: 4px;
      color: var(--muted);
      font-weight: 400;
      font-style: italic;
    }
    .definition {
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
      line-clamp: 2;
      overflow: hidden;
    }
    .status {
      flex-shrink: 0;
      font-size: 0.85rem;
      color: var(--primary);
      font-weight: 600;
    }
    .level {
      margin-right: 6px;
      padding: 1px 6px;
      border-radius: 6px;
      background: var(--surface);
      color: var(--muted);
    }
    .suggestions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      margin-top: -4px;
      font-size: 0.9rem;
    }
    .chip {
      min-height: 36px;
      padding: 4px 12px;
      border: 2px solid var(--border);
      border-radius: var(--wobble-sm);
      background: var(--surface-2);
      color: var(--primary);
      font: inherit;
      cursor: pointer;
    }
    .note {
      margin: 0;
      font-size: 0.9rem;
    }
    .row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
  `,
})
export class AddWordPage {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);

  protected readonly categories = CATEGORIES;
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly levels = signal<Level[]>([]);
  protected readonly lookingUp = signal(false);
  protected readonly lookupError = signal('');
  /** the text of the last search */
  protected readonly searchedFor = signal('');
  /** whether the results of the last search are listed; choosing a dictionary sense closes the list */
  protected readonly resultsOpen = signal(false);
  protected readonly hits = signal<SearchHit[]>([]);
  protected readonly dictionary = signal<DictionarySense[]>([]);
  protected readonly suggestions = signal<string[]>([]);
  /** the dictionary sense the form was filled from */
  protected readonly selected = signal<DictionarySense | null>(null);
  protected readonly form = inject(FormBuilder).nonNullable.group({
    foreign: [''],
    native: [''],
    pronunciation: [''],
    definition: [''],
    example: [''],
    lexicalCategory: [''],
    level: ['?'],
  });

  protected readonly foreign = toSignal(this.form.controls.foreign.valueChanges, { initialValue: '' });

  /** Dictionary senses, each marked when a found database word has the same foreign text and definition. */
  protected readonly dictionaryRows = computed(() => {
    const key = (foreign: string, definition: string | null) => `${normalize(foreign)}\n${normalize(definition ?? '')}`;
    const inDatabase = new Set(this.hits().map((hit) => key(hit.foreign, hit.definition)));
    return this.dictionary().map((sense) => ({ sense, inDatabase: inDatabase.has(key(sense.foreign, sense.definition)) }));
  });

  private readonly definition = toSignal(this.form.controls.definition.valueChanges, { initialValue: '' });

  /**
   * The found database word that saving will use, by the server's rule: the same foreign text and definition, or,
   * for a form with a definition, the word with the same foreign text and none, which then gets this definition.
   */
  protected readonly existing = computed(() => {
    const foreign = normalize(this.foreign());
    if (!foreign) return null;
    const definition = normalize(this.definition());
    const sameForeign = this.hits().filter((h) => normalize(h.foreign) === foreign);
    const same = sameForeign.find((h) => normalize(h.definition ?? '') === definition);
    if (same) return { hit: same, fills: false };
    const undefinedWord = definition ? sameForeign.find((h) => !h.definition?.trim()) : undefined;
    return undefinedWord ? { hit: undefinedWord, fills: true } : null;
  });

  constructor() {
    this.api.levels().then(
      (levels) => this.levels.set(levels),
      () => undefined,
    );
    // Search results belong to the searched or chosen text; editing it into something else drops them.
    this.form.controls.foreign.valueChanges.pipe(takeUntilDestroyed()).subscribe((value) => {
      const text = normalize(value);
      const chosen = this.selected();
      if (text !== normalize(this.searchedFor()) && (!chosen || text !== normalize(chosen.foreign))) this.clearResults();
    });
  }

  /** Searches the database and the dictionary together; either one failing still lists the other's results. */
  protected async search() {
    const query = this.form.controls.foreign.value.trim();
    if (!query || this.lookingUp()) return;
    this.clearResults();
    this.searchedFor.set(query);
    this.lookingUp.set(true);
    let lookupError = '';
    const [hits, lookup] = await Promise.all([
      firstValueFrom(this.api.search(query)).catch(() => [] as SearchHit[]),
      this.api.lookup(query).catch((err) => {
        lookupError = errorMessage(err);
        return { senses: [], suggestions: [] };
      }),
    ]);
    this.lookingUp.set(false);
    // The text was edited while the search ran, which already dropped its results.
    if (this.searchedFor() !== query) return;
    this.hits.set(hits);
    this.dictionary.set(lookup.senses);
    this.suggestions.set(lookup.suggestions);
    this.lookupError.set(lookupError);
    this.resultsOpen.set(true);
  }

  protected searchFor(word: string) {
    this.form.controls.foreign.setValue(word);
    this.search();
  }

  /** Fills the form from a dictionary sense and closes the results; Native and Level are left to the user. */
  protected select(sense: DictionarySense) {
    this.selected.set(sense);
    this.resultsOpen.set(false);
    this.form.patchValue({
      foreign: sense.foreign,
      pronunciation: sense.pronunciation ?? '',
      definition: sense.definition ?? '',
      example: sense.example ?? '',
      lexicalCategory: sense.lexicalCategory ?? '',
    });
  }

  protected async learn(hit: SearchHit) {
    await this.run(() => this.api.learnWord(hit.id));
  }

  protected async submit() {
    const value = this.form.getRawValue();
    if (!value.foreign.trim() || (!value.native.trim() && !this.existing())) {
      this.error.set('Enter both the foreign and the native text.');
      return;
    }
    await this.run(() =>
      this.api.addWord({
        ...value,
        native: value.native.trim() || this.existing()!.hit.native,
        level: value.level === '?' ? null : value.level,
        audio: this.selected()?.audio ?? null,
      }),
    );
  }

  private async run(action: () => Promise<AddResult>) {
    this.busy.set(true);
    this.error.set('');
    try {
      const result = await action();
      this.toast.show(this.describe(result));
      this.form.reset();
      this.clearResults();
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  private clearResults() {
    this.searchedFor.set('');
    this.resultsOpen.set(false);
    this.hits.set([]);
    this.dictionary.set([]);
    this.suggestions.set([]);
    this.selected.set(null);
    this.lookupError.set('');
  }

  private describe({ word, created, filled, previousStage }: AddResult): string {
    if (created) return `“${word.foreign}” added to the dictionary and your list.`;
    if (filled) return `“${word.foreign}” got its definition and is on your list at stage 1.`;
    if (previousStage === null) return `“${word.foreign}” added to your list.`;
    return `“${word.foreign}” is back at stage 1.`;
  }
}
