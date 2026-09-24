import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { catchError, debounceTime, distinctUntilChanged, map, of, switchMap } from 'rxjs';
import { ApiService, errorMessage } from '../core/api.service';
import type { AddResult, Level, SearchHit } from '../core/models';
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
        <label class="field">
          <span>Foreign</span>
          <input formControlName="foreign" autocomplete="off" autocapitalize="none" enterkeyhint="next" />
          <small>Start typing to find words that are already in the dictionary.</small>
        </label>

        @if (hits().length) {
          <ul class="hits" aria-label="Words in the dictionary">
            @for (hit of hits(); track hit.id) {
              <li>
                <button type="button" class="hit" (click)="learn(hit)" [disabled]="busy()">
                  <span class="words">
                    <strong>{{ hit.foreign }}</strong>
                    <span class="muted">{{ hit.native }}</span>
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
          </ul>
        }

        @if (exactHit()) {
          <p class="muted note">
            “{{ exactHit()!.foreign }}” is already in the dictionary. Saving adds that word to your list instead of creating a new one.
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
    .hits {
      list-style: none;
      margin: -4px 0 0;
      padding: 0;
      border: 1px solid var(--border);
      border-radius: 12px;
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
  protected readonly form = inject(FormBuilder).nonNullable.group({
    foreign: [''],
    native: [''],
    pronunciation: [''],
    definition: [''],
    example: [''],
    lexicalCategory: [''],
    level: ['?'],
  });

  private readonly foreign = toSignal(this.form.controls.foreign.valueChanges, { initialValue: '' });

  protected readonly hits = toSignal(
    this.form.controls.foreign.valueChanges.pipe(
      map((q) => q.trim()),
      debounceTime(250),
      distinctUntilChanged(),
      switchMap((q) => (q.length < 2 ? of([]) : this.api.search(q).pipe(catchError(() => of([]))))),
      takeUntilDestroyed(),
    ),
    { initialValue: [] as SearchHit[] },
  );

  protected readonly exactHit = computed(() => {
    const q = normalize(this.foreign());
    return q ? (this.hits().find((h) => normalize(h.foreign) === q) ?? null) : null;
  });

  constructor() {
    this.api.levels().then(
      (levels) => this.levels.set(levels),
      () => undefined,
    );
  }

  protected async learn(hit: SearchHit) {
    await this.run(() => this.api.learnWord(hit.id));
  }

  protected async submit() {
    const value = this.form.getRawValue();
    if (!value.foreign.trim() || (!value.native.trim() && !this.exactHit())) {
      this.error.set('Enter both the foreign and the native text.');
      return;
    }
    await this.run(() =>
      this.api.addWord({
        ...value,
        native: value.native.trim() || this.exactHit()!.native,
        level: value.level === '?' ? null : value.level,
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
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  private describe({ word, created, previousStage }: AddResult): string {
    if (created) return `“${word.foreign}” added to the dictionary and your list.`;
    if (previousStage === null) return `“${word.foreign}” added to your list.`;
    return `“${word.foreign}” is back at stage 1.`;
  }
}
