import { NgTemplateOutlet } from '@angular/common';
import { Component, ElementRef, OnInit, computed, inject, input, output, signal, viewChild } from '@angular/core';
import type { DeckWord } from '../core/models';
import { SpeechService } from '../core/speech.service';
import type { Side } from './learning-session';

type Exit = 'right' | 'down' | 'up';

const TAP_DISTANCE = 10;
const TAP_TIME_MS = 400;
const SWIPE_DISTANCE = 90;
const SWIPE_VELOCITY = 0.5; // px per ms
const EXIT_MS = 220;

/** The direction a drag leans towards most, or null if it goes left (not a gesture). */
function leaning(dx: number, dy: number): { direction: Exit; distance: number } | null {
  const options: { direction: Exit; distance: number }[] = [
    { direction: 'right', distance: dx },
    { direction: 'down', distance: dy },
    { direction: 'up', distance: -dy },
  ];
  const best = options.reduce((a, b) => (b.distance > a.distance ? b : a));
  return best.distance > 0 ? best : null;
}

/**
 * A two-sided card. Tap flips it; drag right ("again"), down ("done") or up ("known") throws it off the deck.
 * Up only works while `canMarkKnown` is true; otherwise an upward drag springs back.
 * The parent listens to `again` / `done` / `known`, which fire after the throw animation has finished.
 * The speaker button reads the foreign word aloud; with auto-play on, it is read whenever the foreign side shows.
 */
@Component({
  selector: 'app-flash-card',
  template: `
    <div
      #card
      class="card"
      [class.dragging]="dragging()"
      [style.transform]="transform()"
      [style.transition-duration.ms]="dragging() ? 0 : exitMs"
      (pointerdown)="onPointerDown($event)"
      (pointermove)="onPointerMove($event)"
      (pointerup)="onPointerUp($event)"
      (pointercancel)="reset()"
      (keydown)="onKey($event)"
      tabindex="0"
      role="button"
      [attr.aria-label]="(word().autoAdded ? 'Auto-added. ' : '') + textOf(flipped() ? back() : front()) + '. Tap to flip.'"
    >
      <div class="hint again" [style.opacity]="hintOpacity().again">Again</div>
      <div class="hint done" [style.opacity]="hintOpacity().done">Done</div>
      <div class="hint known" [style.opacity]="hintOpacity().up">Known</div>
      <div class="inner" [class.flipped]="flipped()">
        <section class="sketch-twice face front">
          <ng-container *ngTemplateOutlet="face; context: { text: textOf(front()) }" />
        </section>
        <section class="sketch-twice face back">
          <ng-container *ngTemplateOutlet="face; context: { text: textOf(back()) }" />
        </section>
      </div>
      @if (speech.supported) {
        <button
          class="speak"
          type="button"
          [attr.aria-label]="'Play pronunciation of ' + word().foreign"
          (pointerdown)="$event.stopPropagation()"
          (keydown)="$event.stopPropagation()"
          (click)="speak()"
        >
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" />
            <path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
          </svg>
        </button>
      }
    </div>

    <ng-template #face let-text="text">
      @if (word().autoAdded) {
        <span class="tag" aria-hidden="true">auto-added</span>
      }
      <div class="text" [class.long]="text.length > 40">{{ text }}</div>
    </ng-template>
  `,
  imports: [NgTemplateOutlet],
  styleUrl: './flash-card.scss',
})
export class FlashCard implements OnInit {
  readonly word = input.required<DeckWord>();
  readonly front = input.required<Side>();
  /** whether swiping up ("known") is allowed for this card */
  readonly canMarkKnown = input(false);

  readonly again = output<void>();
  readonly done = output<void>();
  readonly known = output<void>();

  protected readonly speech = inject(SpeechService);
  protected readonly exitMs = EXIT_MS;
  protected readonly back = computed<Side>(() => (this.front() === 'native' ? 'foreign' : 'native'));
  protected readonly flipped = signal(false);
  protected readonly dragging = signal(false);
  private readonly dx = signal(0);
  private readonly dy = signal(0);
  private readonly exit = signal<Exit | null>(null);
  private readonly card = viewChild.required<ElementRef<HTMLElement>>('card');

  private start: { x: number; y: number; t: number; id: number } | null = null;

  ngOnInit() {
    this.autoSpeak();
  }

  protected readonly transform = computed(() => {
    const exit = this.exit();
    if (exit === 'right') return `translate(130vw, ${this.dy()}px) rotate(30deg)`;
    if (exit === 'down') return `translate(${this.dx()}px, 110vh)`;
    if (exit === 'up') return `translate(${this.dx()}px, -110vh)`;
    const dx = this.dx();
    const dy = this.dy();
    return dx || dy ? `translate(${dx}px, ${dy}px) rotate(${dx / 18}deg)` : '';
  });

  protected readonly hintOpacity = computed(() => {
    const lean = leaning(this.dx(), this.dy());
    const opacity = (direction: Exit) => (lean?.direction === direction ? Math.min(1, lean.distance / SWIPE_DISTANCE) : 0);
    return { again: opacity('right'), done: opacity('down'), up: this.canMarkKnown() ? opacity('up') : 0 };
  });

  protected textOf(side: Side) {
    return side === 'native' ? this.word().native : this.word().foreign;
  }

  focus() {
    this.card().nativeElement.focus({ preventScroll: true });
  }

  flip() {
    if (this.exit()) return;
    this.flipped.update((f) => !f);
    this.autoSpeak();
  }

  protected speak() {
    this.speech.speak(this.word().foreign);
  }

  /** Reads the word if auto-play is on and the foreign side is now showing. */
  autoSpeak() {
    const showing = this.flipped() ? this.back() : this.front();
    if (this.speech.autoPlay() && showing === 'foreign') this.speak();
  }

  /** Throws the card off the deck, then emits the matching output. */
  throw(direction: Exit) {
    if (this.exit() || (direction === 'up' && !this.canMarkKnown())) return;
    this.exit.set(direction);
    const emitter = { right: this.again, down: this.done, up: this.known }[direction];
    setTimeout(() => emitter.emit(), EXIT_MS);
  }

  protected onPointerDown(event: PointerEvent) {
    if (this.exit() || (event.pointerType === 'mouse' && event.button !== 0)) return;
    this.start = { x: event.clientX, y: event.clientY, t: event.timeStamp, id: event.pointerId };
    this.card().nativeElement.setPointerCapture(event.pointerId);
    this.dragging.set(true);
  }

  protected onPointerMove(event: PointerEvent) {
    if (!this.start || event.pointerId !== this.start.id) return;
    this.dx.set(event.clientX - this.start.x);
    this.dy.set(event.clientY - this.start.y);
  }

  protected onPointerUp(event: PointerEvent) {
    if (!this.start || event.pointerId !== this.start.id) return;
    const dx = event.clientX - this.start.x;
    const dy = event.clientY - this.start.y;
    const elapsed = Math.max(1, event.timeStamp - this.start.t);
    this.start = null;
    this.dragging.set(false);

    const distance = Math.hypot(dx, dy);
    if (distance < TAP_DISTANCE && elapsed < TAP_TIME_MS) {
      this.reset();
      this.flip();
      return;
    }
    const fast = distance / elapsed > SWIPE_VELOCITY;
    const lean = leaning(dx, dy);
    const swiped = lean && (lean.distance > SWIPE_DISTANCE || (fast && lean.distance > 30));
    if (swiped && (lean.direction !== 'up' || this.canMarkKnown())) this.throw(lean.direction);
    else this.reset();
  }

  protected reset() {
    this.start = null;
    this.dragging.set(false);
    this.dx.set(0);
    this.dy.set(0);
  }

  protected onKey(event: KeyboardEvent) {
    const actions: Record<string, () => void> = {
      ' ': () => this.flip(),
      Enter: () => this.flip(),
      ArrowRight: () => this.throw('right'),
      ArrowDown: () => this.throw('down'),
      ArrowUp: () => this.throw('up'),
    };
    const action = actions[event.key];
    if (action) {
      event.preventDefault();
      action();
    }
  }
}
