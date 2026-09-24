import { NgTemplateOutlet } from '@angular/common';
import { Component, ElementRef, computed, input, output, signal, viewChild } from '@angular/core';
import type { DeckWord } from '../core/models';
import type { Side } from './learning-session';

type Exit = 'right' | 'down';

const TAP_DISTANCE = 10;
const TAP_TIME_MS = 400;
const SWIPE_DISTANCE = 90;
const SWIPE_VELOCITY = 0.5; // px per ms
const EXIT_MS = 220;

/**
 * A two-sided card. Tap flips it; drag right ("again") or down ("done") throws it off the deck.
 * The parent listens to `again` / `done`, which fire after the throw animation has finished.
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
      [attr.aria-label]="'Card showing ' + (flipped() ? back() : front()) + ' text. Tap to flip.'"
    >
      <div class="hint again" [style.opacity]="hintOpacity().again">Again</div>
      <div class="hint done" [style.opacity]="hintOpacity().done">Done</div>
      <div class="inner" [class.flipped]="flipped()">
        <section class="face front">
          <ng-container *ngTemplateOutlet="face; context: { side: front(), details: false }" />
        </section>
        <section class="face back">
          <ng-container *ngTemplateOutlet="face; context: { side: back(), details: true }" />
        </section>
      </div>
    </div>

    <ng-template #face let-side="side" let-details="details">
      <div class="meta">
        <span class="side">{{ side === 'native' ? 'Native' : 'Foreign' }}</span>
        @if (known()) {
          <span class="badge">Known</span>
        }
      </div>
      <div class="text" [class.long]="(side === 'native' ? word().native : word().foreign).length > 40">
        {{ side === 'native' ? word().native : word().foreign }}
      </div>
      @if (side === 'foreign' && word().pronunciation) {
        <div class="pron">{{ word().pronunciation }}</div>
      }
      @if (details) {
        <dl class="details">
          @if (word().lexicalCategory || word().level !== '?') {
            <div class="tags">
              @if (word().lexicalCategory) {
                <span>{{ word().lexicalCategory }}</span>
              }
              @if (word().level !== '?') {
                <span>{{ word().level }}</span>
              }
            </div>
          }
          @if (word().definition) {
            <dt>Definition</dt>
            <dd>{{ word().definition }}</dd>
          }
          @if (word().example) {
            <dt>Example</dt>
            <dd class="example">{{ word().example }}</dd>
          }
        </dl>
      }
    </ng-template>
  `,
  imports: [NgTemplateOutlet],
  styleUrl: './flash-card.scss',
})
export class FlashCard {
  readonly word = input.required<DeckWord>();
  readonly front = input.required<Side>();
  readonly known = input(false);

  readonly again = output<void>();
  readonly done = output<void>();

  protected readonly exitMs = EXIT_MS;
  protected readonly back = computed<Side>(() => (this.front() === 'native' ? 'foreign' : 'native'));
  protected readonly flipped = signal(false);
  protected readonly dragging = signal(false);
  private readonly dx = signal(0);
  private readonly dy = signal(0);
  private readonly exit = signal<Exit | null>(null);
  private readonly card = viewChild.required<ElementRef<HTMLElement>>('card');

  private start: { x: number; y: number; t: number; id: number } | null = null;

  protected readonly transform = computed(() => {
    const exit = this.exit();
    if (exit === 'right') return `translate(130vw, ${this.dy()}px) rotate(30deg)`;
    if (exit === 'down') return `translate(${this.dx()}px, 110vh)`;
    const dx = this.dx();
    const dy = this.dy();
    return dx || dy ? `translate(${dx}px, ${dy}px) rotate(${dx / 18}deg)` : '';
  });

  protected readonly hintOpacity = computed(() => {
    const dx = Math.max(0, this.dx());
    const dy = Math.max(0, this.dy());
    return {
      again: dx > dy ? Math.min(1, dx / SWIPE_DISTANCE) : 0,
      done: dy >= dx ? Math.min(1, dy / SWIPE_DISTANCE) : 0,
    };
  });

  focus() {
    this.card().nativeElement.focus({ preventScroll: true });
  }

  flip() {
    if (!this.exit()) this.flipped.update((f) => !f);
  }

  /** Throws the card off the deck, then emits the matching output. */
  throw(direction: Exit) {
    if (this.exit()) return;
    this.exit.set(direction);
    setTimeout(() => (direction === 'right' ? this.again.emit() : this.done.emit()), EXIT_MS);
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
    // Dragging up is not a gesture; resist it so the card does not fly off the top.
    const dy = event.clientY - this.start.y;
    this.dy.set(dy < 0 ? dy / 4 : dy);
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
    if (dx > dy && (dx > SWIPE_DISTANCE || (fast && dx > 30))) this.throw('right');
    else if (dy >= dx && (dy > SWIPE_DISTANCE || (fast && dy > 30))) this.throw('down');
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
    };
    const action = actions[event.key];
    if (action) {
      event.preventDefault();
      action();
    }
  }
}
