import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService, errorMessage } from '../core/api.service';
import type { UserWord } from '../core/models';

const KNOWN_STAGE = 6;

const normalize = (text: string) => text.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();

type View = 'loading' | 'error' | 'empty' | 'ready';

/** Every word on the user's list, newest first, filtered by the foreign text while typing. */
@Component({
  selector: 'app-word-list-page',
  imports: [RouterLink],
  template: `
    <div class="page">
      <header class="topbar">
        <a class="btn icon" routerLink="/" aria-label="Back">←</a>
        <h1>My words</h1>
      </header>

      @switch (view()) {
        @case ('loading') {
          <p class="muted">Loading your words…</p>
        }
        @case ('error') {
          <div class="panel">
            <p class="error" role="alert">{{ error() }}</p>
            <button class="btn primary block" (click)="load()">Try again</button>
          </div>
        }
        @case ('empty') {
          <div class="panel">
            <p>You have no words yet.</p>
            <a class="btn primary block" routerLink="/add">Add a word</a>
          </div>
        }
        @case ('ready') {
          <label class="field">
            <span>Search</span>
            <input
              type="search"
              name="q"
              autocomplete="off"
              autocapitalize="none"
              enterkeyhint="search"
              [value]="query()"
              (input)="query.set($any($event.target).value)"
            />
            <small>{{ filtered().length }} of {{ words().length }} words.</small>
          </label>

          @if (filtered().length) {
            <ul class="panel words" aria-label="Your words, newest first">
              @for (word of filtered(); track word.id) {
                <li>
                  <span class="foreign">{{ word.foreign }}</span>
                  <span class="stage" [class.known]="word.stage === knownStage">stage {{ word.stage }}</span>
                  <a class="btn icon" [routerLink]="['/words', word.id, 'edit']" [attr.aria-label]="'Edit ' + word.foreign">✎</a>
                </li>
              }
            </ul>
          } @else {
            <p class="muted">No word contains “{{ query().trim() }}”.</p>
          }
        }
      }
    </div>
  `,
  styles: `
    .words {
      list-style: none;
      margin: 0;
      padding: 8px 8px 8px 16px;
    }
    li {
      display: flex;
      align-items: center;
      gap: 12px;
      min-height: 52px;
      padding: 4px 0;
    }
    li + li {
      border-top: 1px dashed var(--border);
    }
    .foreign {
      flex: 1;
      min-width: 0;
      overflow-wrap: anywhere;
      font-weight: 600;
    }
    .stage {
      flex: none;
      padding: 2px 10px;
      border-radius: var(--wobble-sm);
      background: var(--lavender);
      color: var(--primary-text);
      font-size: 0.8rem;
      font-weight: 700;
      &.known {
        background: var(--mint);
      }
    }
  `,
})
export class WordListPage {
  private readonly api = inject(ApiService);

  protected readonly knownStage = KNOWN_STAGE;
  protected readonly view = signal<View>('loading');
  protected readonly error = signal('');
  protected readonly words = signal<UserWord[]>([]);
  protected readonly query = signal('');
  protected readonly filtered = computed(() => {
    const q = normalize(this.query());
    return q ? this.words().filter((w) => normalize(w.foreign).includes(q)) : this.words();
  });

  constructor() {
    void this.load();
  }

  protected async load() {
    this.view.set('loading');
    try {
      const words = await this.api.myWords();
      this.words.set(words);
      this.view.set(words.length ? 'ready' : 'empty');
    } catch (err) {
      this.error.set(errorMessage(err));
      this.view.set('error');
    }
  }
}
