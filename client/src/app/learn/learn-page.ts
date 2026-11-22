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
  canMarkKnown,
  clearSession,
  completedPasses,
  currentCard,
  deckEmpty,
  done,
  loadSession,
  markKnown,
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
          <div class="progress sketch" role="progressbar" [attr.aria-valuenow]="progress()" aria-valuemin="0" aria-valuemax="100">
            <div [style.width.%]="progress()"></div>
          </div>

          <div class="deck">
            @for (ghost of ghosts(); track ghost) {
              <div class="ghost sketch" [style.--i]="ghost"></div>
            }
            @if (card(); as c) {
              @for (key of [c.key]; track key) {
                <app-flash-card
                  [word]="c.word"
                  [front]="c.side"
                  [canMarkKnown]="knownAllowed()"
                  (again)="onAgain()"
                  (done)="onDone()"
                  (known)="onKnown()"
                />
              }
            }
          </div>

          @if (speech.supported) {
            <label class="switch">
              <input type="checkbox" role="switch" [checked]="speech.autoPlay()" (change)="toggleAutoPlay($event)" />
              <span class="track" aria-hidden="true"></span>
              Auto-play English pronunciation
            </label>
          }
          <p class="muted hint touch">
            Tap to flip · swipe right to repeat · down when you got it{{ knownAllowed() ? ' · up if you already know it' : '' }}
          </p>
          <p class="muted hint keys">
            Space to flip · → to repeat · ↓ when you got it{{ knownAllowed() ? ' · ↑ if you already know it' : '' }}
          </p>
        }
      }
    </div>
  `,
  styleUrl: './deck-page.scss',
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
  protected readonly knownAllowed = computed(() => {
    const s = this.state();
    return s ? canMarkKnown(s) : false;
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
      else if (deckEmpty(saved)) await this.leaveEmptyDeck();
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

  /** Swipe up on an auto-added word's first appearance: the word goes straight to known and leaves the deck. */
  protected async onKnown() {
    const s = this.state()!;
    const card = currentCard(s);
    if (!card || !canMarkKnown(s)) return;
    try {
      await this.api.markKnown(card.word.id);
    } catch (err) {
      // Nothing changed on the server, so keep the word and show it again later.
      this.toast.show(errorMessage(err, 'Could not mark the word as known.'));
      this.update(again(s));
      return;
    }
    const next = markKnown(s);
    this.update(next);
    if (next.finished) void this.finish();
    else if (deckEmpty(next)) await this.leaveEmptyDeck();
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
      ArrowUp: () => card.throw('up'),
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

  /** Every learn word was marked known before the turns ran out: nothing is left to learn in this deck. */
  private async leaveEmptyDeck() {
    clearSession(this.userId);
    this.toast.show('You know every word in this deck now.');
    await this.router.navigateByUrl('/');
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
