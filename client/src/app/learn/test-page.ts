import { Component, DestroyRef, computed, inject, signal, viewChild } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { SpeechService } from '../core/speech.service';
import { ToastService } from '../core/toast.service';
import { FlashCard } from './flash-card';
import { TestSelectionService } from './test-selection.service';
import { TEST_TURNS, again, currentCard, done, startTest, testProgress, testTurnLabel, type TestState } from './test-session';

/**
 * Goes through the words picked on the test selection page in two turns (random side, then the other side).
 * Nothing is sent to the server, so the words' stages stay as they are.
 */
@Component({
  selector: 'app-test-page',
  imports: [FlashCard, RouterLink],
  template: `
    <div class="page learn">
      <header class="topbar">
        <a class="btn icon" routerLink="/" aria-label="Leave the test">✕</a>
        @if (state(); as s) {
          <h1>Turn {{ s.turn + 1 }}/{{ turns }} · {{ label() }}</h1>
          <span class="muted count">{{ s.queue.length }} left</span>
        }
      </header>

      @if (state(); as s) {
        <div class="progress sketch" role="progressbar" [attr.aria-valuenow]="progress()" aria-valuemin="0" aria-valuemax="100">
          <div [style.width.%]="progress()"></div>
        </div>

        <div class="deck">
          @for (ghost of ghosts(); track ghost) {
            <div class="ghost sketch" [style.--i]="ghost"></div>
          }
          @if (card(); as c) {
            @for (key of [c.key]; track key) {
              <app-flash-card [word]="c.word" [front]="c.side" (again)="onAgain()" (done)="onDone()" />
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
        <p class="muted hint touch">Tap to flip · swipe right to repeat · down when you got it</p>
        <p class="muted hint keys">Space to flip · → to repeat · ↓ when you got it</p>
      }
    </div>
  `,
  styleUrl: './deck-page.scss',
  host: { '(document:keydown)': 'onKey($event)' },
})
export class TestPage {
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  protected readonly speech = inject(SpeechService);

  protected readonly turns = TEST_TURNS;
  protected readonly state = signal<TestState | null>(null);
  protected readonly card = computed(() => {
    const s = this.state();
    return s ? currentCard(s) : null;
  });
  protected readonly label = computed(() => {
    const s = this.state();
    return s ? testTurnLabel(s) : '';
  });
  protected readonly progress = computed(() => {
    const s = this.state();
    return s ? testProgress(s) : 0;
  });
  /** Up to two cards drawn behind the top card. */
  protected readonly ghosts = computed(() => {
    const behind = Math.min(2, (this.state()?.queue.length ?? 1) - 1);
    return Array.from({ length: behind }, (_, i) => behind - i);
  });
  protected readonly flashCard = viewChild(FlashCard);

  constructor() {
    inject(DestroyRef).onDestroy(() => this.speech.stop());
    const selection = inject(TestSelectionService);
    const words = selection.words();
    selection.words.set([]); // one test per pick: going back to this page later does not restart it
    // Nothing picked, e.g. after a reload: the test is not kept, so pick the words again.
    if (!words.length) void this.router.navigateByUrl('/test', { replaceUrl: true });
    else this.state.set(startTest(words));
  }

  protected onAgain() {
    this.state.update((s) => again(s!));
  }

  protected onDone() {
    const next = done(this.state()!);
    this.state.set(next);
    if (next.finished) {
      this.toast.show('Test complete.');
      void this.router.navigateByUrl('/');
    }
  }

  protected toggleAutoPlay(event: Event) {
    const on = (event.target as HTMLInputElement).checked;
    this.speech.setAutoPlay(on);
    // Read the English side right away if it is showing; this tap also unlocks speech on iOS.
    if (on) this.flashCard()?.autoSpeak();
  }

  protected onKey(event: KeyboardEvent) {
    // Keys work anywhere on the page, not only when the card has focus.
    if (!this.card() || event.target instanceof HTMLInputElement) return;
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
}
