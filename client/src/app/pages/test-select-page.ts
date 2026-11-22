import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ApiService, errorMessage } from '../core/api.service';
import type { UserWord } from '../core/models';
import { TestSelectionService } from '../learn/test-selection.service';

const KNOWN_STAGE = 6;
const DEFAULT_TOP = 10;

type View = 'loading' | 'error' | 'empty' | 'ready';

/** Lists the user's words, newest first, to pick the ones a test goes through. */
@Component({
  selector: 'app-test-select-page',
  imports: [RouterLink],
  template: `
    <div class="page">
      <header class="topbar">
        <a class="btn icon" routerLink="/" aria-label="Back">←</a>
        <h1>Test my words</h1>
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
          <label class="field top">
            <span>Select the newest</span>
            <input
              type="number"
              name="top"
              min="0"
              [max]="words().length"
              inputmode="numeric"
              [value]="top()"
              (input)="selectTop($event)"
            />
            <small>{{ selected().size }} of {{ words().length }} words selected.</small>
          </label>

          <ul class="panel words" aria-label="Your words, newest first">
            @for (word of words(); track word.id) {
              <li>
                <label class="check">
                  <input type="checkbox" [checked]="selected().has(word.id)" (change)="toggle(word.id)" />
                  <span class="foreign">{{ word.foreign }}</span>
                  <span class="stage" [class.known]="word.stage === knownStage">{{ stageLabel(word) }}</span>
                </label>
              </li>
            }
          </ul>

          <div class="start">
            <button class="btn primary big block" [disabled]="!selected().size" (click)="start()">
              Start test ({{ selected().size }})
            </button>
          </div>
        }
      }
    </div>
  `,
  styles: `
    .top input {
      max-width: 120px;
    }
    .words {
      list-style: none;
      margin: 0;
      padding: 8px 16px;
    }
    li + li {
      border-top: 1px dashed var(--border);
    }
    .check {
      align-items: center;
      min-height: 48px;
      padding: 6px 0;
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
    /* Keeps the start button in reach while scrolling a long list. */
    .start {
      position: sticky;
      bottom: 0;
      padding: 12px 0 max(4px, env(safe-area-inset-bottom));
      margin-top: auto;
      background: linear-gradient(transparent, var(--bg) 35%);
    }
  `,
})
export class TestSelectPage {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly selection = inject(TestSelectionService);

  protected readonly knownStage = KNOWN_STAGE;
  protected readonly view = signal<View>('loading');
  protected readonly error = signal('');
  protected readonly words = signal<UserWord[]>([]);
  protected readonly top = signal(0);
  protected readonly selected = signal<ReadonlySet<number>>(new Set());
  private readonly selectedWords = computed(() => this.words().filter((w) => this.selected().has(w.id)));

  constructor() {
    void this.load();
  }

  protected async load() {
    this.view.set('loading');
    try {
      const words = await this.api.myWords();
      this.words.set(words);
      this.setTop(Math.min(DEFAULT_TOP, words.length));
      this.view.set(words.length ? 'ready' : 'empty');
    } catch (err) {
      this.error.set(errorMessage(err));
      this.view.set('error');
    }
  }

  protected stageLabel(word: UserWord) {
    return word.stage === KNOWN_STAGE ? 'known' : `stage ${word.stage}`;
  }

  protected selectTop(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!Number.isFinite(input.valueAsNumber)) return; // empty while typing
    const n = Math.max(0, Math.min(Math.floor(input.valueAsNumber), this.words().length));
    if (n !== input.valueAsNumber) input.value = String(n);
    this.setTop(n);
  }

  private setTop(n: number) {
    this.top.set(n);
    this.selected.set(new Set(this.words().slice(0, n).map((w) => w.id)));
  }

  protected toggle(id: number) {
    const next = new Set(this.selected());
    if (!next.delete(id)) next.add(id);
    this.selected.set(next);
  }

  protected async start() {
    this.selection.words.set(this.selectedWords());
    await this.router.navigateByUrl('/test/run');
  }
}
