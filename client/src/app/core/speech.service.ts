import { Injectable, signal } from '@angular/core';

const LANG = 'en-GB';
const AUTO_PLAY_KEY = 'learnwords.autoPlay';

/**
 * Reads English words aloud with the browser's built-in speech synthesis, in a British voice when the
 * device has one. The auto-play preference is per device, so it lives in localStorage.
 */
@Injectable({ providedIn: 'root' })
export class SpeechService {
  private readonly synth: SpeechSynthesis | undefined = globalThis.speechSynthesis;
  private voice: SpeechSynthesisVoice | null = null;

  readonly supported = !!this.synth && typeof SpeechSynthesisUtterance !== 'undefined';
  readonly autoPlay = signal(this.loadAutoPlay());

  constructor() {
    if (!this.supported) return;
    // Voices load asynchronously in most browsers.
    this.pickVoice();
    this.synth!.addEventListener?.('voiceschanged', () => this.pickVoice());
  }

  speak(text: string) {
    if (!this.supported || !text.trim()) return;
    // Drop anything still playing so a quick card change does not queue up words.
    this.synth!.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = LANG;
    if (this.voice) utterance.voice = this.voice;
    utterance.rate = 0.9;
    this.synth!.speak(utterance);
  }

  stop() {
    if (this.supported) this.synth!.cancel();
  }

  setAutoPlay(on: boolean) {
    this.autoPlay.set(on);
    try {
      localStorage.setItem(AUTO_PLAY_KEY, on ? '1' : '0');
    } catch {
      // Storage blocked: the setting just lasts until the page is closed.
    }
  }

  private loadAutoPlay(): boolean {
    try {
      return localStorage.getItem(AUTO_PLAY_KEY) === '1';
    } catch {
      return false;
    }
  }

  private pickVoice() {
    // Android reports tags like "en_GB", so normalise before comparing.
    const british = this.synth!.getVoices().filter((v) => v.lang.replace('_', '-').toLowerCase() === 'en-gb');
    this.voice = british.find((v) => v.default) ?? british.find((v) => v.localService) ?? british[0] ?? null;
  }
}
