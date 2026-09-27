import { Component, DestroyRef, computed, inject, signal, viewChild } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ApiService, errorMessage } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { SpeechService } from '../core/speech.service';
import { ToastService } from '../core/toast.service';
import { FlashCard } from './flash-card';
import {
  TOTAL_PASSES,
  TURNS,
  again,
  clearSession,
  completedPasses,
  currentCard,
  done,
  loadSession,
  saveSession,
  startSession,
  turnLabel,
  turnWordIds,
  type SessionState,
} from './learning-session';

type View = 'loading' | 'empty' | 'learning' | 'saving' | 'error';

@Component({
  selector: 'app-learn-page',
  imports: [FlashCard, RouterLink],
  template: `
    <div class="page learn">
      <header class="topbar">
        <a class="btn icon" routerLink="/" aria-label="Leave session (progress is kept)">✕</a>
        @if (state(); as s) {
          <h1>Turn {{ s.turn + 1 }}/{{ turns }} · {{ label() }}</h1>
          <span class="muted count">{{ s.queue.length }} left</span>
        } @else {
          <h1>Learn</h1>
        }
      </header>

      @switch (view()) {
        @case ('loading') {
          <p class="muted center">Preparing your deck…</p>
        }
        @case ('empty') {
          <div class="panel center">
            <h2>Nothing to learn right now</h2>
            <p class="muted">Add new words, or come back when your words are due for their next stage.</p>
            <a class="btn primary block" routerLink="/add">Add a word</a>
          </div>
        }
        @case ('error') {
          <div class="panel center">
            <p class="error">{{ error() }}</p>
            <button class="btn primary block" (click)="retry()">Try again</button>
          </div>
        }
        @case ('saving') {
          <p class="muted center">Saving your progress…</p>
        }
        @case ('learning') {
          <div class="progress" role="progressbar" [attr.aria-valuenow]="progress()" aria-valuemin="0" aria-valuemax="100">
            <div [style.width.%]="progress()"></div>
          </div>

          <div class="deck">
            @for (ghost of ghosts(); track ghost) {
              <div class="ghost" [style.--i]="ghost"></div>
            }
            @if (card(); as c) {
              @for (key of [c.key]; track key) {
                <app-flash-card
                  [word]="c.word"
                  [front]="c.side"
                  (again)="onAgain()"
                  (done)="onDone()"
                />
              }
            }
          </div>

          <div class="actions">
            <button class="btn again" (click)="flashCard()?.throw('right')" aria-label="Again: put the card to the bottom">
              ↻ Again
            </button>
            <button class="btn" (click)="flashCard()?.flip()">Flip</button>
            <button class="btn done" (click)="flashCard()?.throw('down')" aria-label="Done: take the card out for this turn">
              ✓ Done
            </button>
          </div>
          @if (speech.supported) {
            <label class="switch">
              <input type="checkbox" role="switch" [checked]="speech.autoPlay()" (change)="toggleAutoPlay($event)" />
              <span class="track" aria-hidden="true"></span>
              Auto-play English pronunciation
            </label>
          }
          <p class="muted hint">Tap to flip · swipe right to repeat · swipe down when you know it</p>
        }
      }
    </div>
  `,
  styles: `
    .learn {
      height: 100dvh;
      overflow: hidden;
    }
    .count {
      font-variant-numeric: tabular-nums;
    }
    .center {
      text-align: center;
      margin: auto 0;
    }
    .progress {
      height: 6px;
      border-radius: 3px;
      background: rgb(255 255 255 / 0.08);
      overflow: hidden;
      div {
        height: 100%;
        border-radius: inherit;
        background: linear-gradient(90deg, var(--mint), var(--sky), var(--lavender), var(--pink));
        background-size: 100vw 100%;
        box-shadow: 0 0 12px rgb(196 179 255 / 0.5);
        transition: width 300ms ease;
      }
    }
    .deck {
      position: relative;
      width: 100%;
      aspect-ratio: 2 / 1;
      margin: auto 0;
    }
    .ghost {
      position: absolute;
      inset: 0;
      border-radius: 14px;
      background: var(--paper-edge);
      box-shadow: 0 8px 20px rgb(0 0 0 / 0.35);
      transform: translateY(calc(var(--i) * 9px)) rotate(calc(var(--i) * 1.2deg)) scale(calc(1 - var(--i) * 0.04));
      filter: brightness(calc(0.85 - var(--i) * 0.15));
    }
    .actions {
      display: grid;
      grid-template-columns: 1fr auto 1fr;
      gap: 8px;
      .again {
        color: var(--again);
        background: rgb(255 201 163 / 0.12);
        border-color: rgb(255 201 163 / 0.35);
      }
      .done {
        color: var(--done);
        background: rgb(166 236 208 / 0.12);
        border-color: rgb(166 236 208 / 0.35);
      }
    }
    .switch {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      min-height: 44px;
      font-size: 0.95rem;
      cursor: pointer;
      user-select: none;
      input {
        position: absolute;
        opacity: 0;
        width: 1px;
        height: 1px;
        min-height: 0;
        pointer-events: none;
      }
      .track {
        position: relative;
        flex: none;
        width: 44px;
        height: 26px;
        border-radius: 13px;
        background: rgb(255 255 255 / 0.12);
        border: 1px solid var(--glass-border);
        transition: background-color 150ms ease;
        &::after {
          content: '';
          position: absolute;
          top: 2px;
          left: 2px;
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: var(--text);
          box-shadow: 0 1px 3px rgb(0 0 0 / 0.4);
          transition: transform 150ms ease;
        }
      }
      input:checked + .track {
        background: var(--gradient);
        border-color: transparent;
        &::after {
          transform: translateX(18px);
          background: var(--primary-text);
        }
      }
      input:focus-visible + .track {
        outline: 2px solid var(--primary);
        outline-offset: 2px;
      }
    }
    .hint {
      margin: 0;
      text-align: center;
      font-size: 0.85rem;
    }
  `,
  host: { '(document:keydown)': 'onKey($event)' },
})
export class LearnPage {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  protected readonly speech = inject(SpeechService);

  protected readonly turns = TURNS.length;
  protected readonly view = signal<View>('loading');
  protected readonly error = signal('');
  protected readonly state = signal<SessionState | null>(null);
  protected readonly card = computed(() => {
    const s = this.state();
    return s ? currentCard(s) : null;
  });
  protected readonly label = computed(() => {
    const s = this.state();
    return s ? turnLabel(s) : '';
  });
  protected readonly progress = computed(() => {
    const s = this.state();
    if (!s) return 0;
    // Count the current pass as partly done so the bar moves within a pass too.
    const withinPass = 1 - s.queue.length / turnWordIds(s.deck, s.turn).length;
    return Math.round(((completedPasses(s) + withinPass) / TOTAL_PASSES) * 100);
  });
  /** Up to two cards drawn behind the top card. */
  protected readonly ghosts = computed(() => {
    const behind = Math.min(2, (this.state()?.queue.length ?? 1) - 1);
    return Array.from({ length: behind }, (_, i) => behind - i);
  });
  protected readonly flashCard = viewChild(FlashCard);

  private readonly userId = this.auth.user()!.id;

  constructor() {
    void this.init();
    inject(DestroyRef).onDestroy(() => this.speech.stop());
  }

  private async init() {
    const saved = loadSession(this.userId);
    if (saved) {
      this.state.set(saved);
      if (saved.finished) await this.finish();
      else this.view.set('learning');
      return;
    }
    this.view.set('loading');
    try {
      const deck = await this.api.startSession();
      if (!deck.learn.length) {
        this.view.set('empty');
        return;
      }
      this.update(startSession(this.userId, deck));
      this.view.set('learning');
    } catch (err) {
      this.error.set(errorMessage(err));
      this.view.set('error');
    }
  }

  protected retry() {
    const s = this.state();
    if (s?.finished) void this.finish();
    else void this.init();
  }

  protected onAgain() {
    this.update(again(this.state()!));
  }

  protected onDone() {
    const next = done(this.state()!);
    this.update(next);
    if (next.finished) void this.finish();
  }

  protected toggleAutoPlay(event: Event) {
    const on = (event.target as HTMLInputElement).checked;
    this.speech.setAutoPlay(on);
    // Read the English side right away if it is showing; this tap also unlocks speech on iOS.
    if (on) this.flashCard()?.autoSpeak();
  }

  protected onKey(event: KeyboardEvent) {
    // Keys work anywhere on the page, not only when the card has focus.
    if (this.view() !== 'learning' || event.target instanceof HTMLInputElement) return;
    const card = this.flashCard();
    if (!card || (event.target as HTMLElement | null)?.closest?.('app-flash-card, button')) return;
    const actions: Record<string, () => void> = {
      ' ': () => card.flip(),
      ArrowRight: () => card.throw('right'),
      ArrowDown: () => card.throw('down'),
    };
    const action = actions[event.key];
    if (action) {
      event.preventDefault();
      action();
    }
  }

  private update(state: SessionState) {
    this.state.set(state);
    saveSession(state);
  }

  private async finish() {
    const s = this.state()!;
    this.view.set('saving');
    try {
      const result = await this.api.completeSession({
        issuedAt: s.deck.issuedAt,
        learnIds: s.deck.learn.map((w) => w.id),
        knownIds: s.deck.known.map((w) => w.id),
      });
      clearSession(this.userId);
      this.toast.show(
        result.advanced
          ? `Well done! ${result.advanced} word${result.advanced === 1 ? '' : 's'} moved up a stage.`
          : 'Session complete.',
      );
      await this.router.navigateByUrl('/');
    } catch (err) {
      this.error.set(`${errorMessage(err)} Your session is saved, so nothing is lost.`);
      this.view.set('error');
    }
  }
}
