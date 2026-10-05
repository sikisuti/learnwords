import { Injectable, signal } from '@angular/core';

const LANG = 'en-GB';
const AUTO_PLAY_KEY = 'learnwords.autoPlay';

/**
 * Reads English words aloud: a word's dictionary recording when it has one, otherwise the browser's built-in
 * speech synthesis, in a British voice when the device has one. The auto-play preference is per device, so it
 * lives in localStorage.
 */
@Injectable({ providedIn: 'root' })
export class SpeechService {
  private readonly synth: SpeechSynthesis | undefined = globalThis.speechSynthesis;
  private voice: SpeechSynthesisVoice | null = null;
  /** the recording currently playing, so the next word can stop it */
  private recording: HTMLAudioElement | null = null;

  private readonly canSynthesize = !!this.synth && typeof SpeechSynthesisUtterance !== 'undefined';
  private readonly canPlayRecordings = typeof Audio !== 'undefined';
  readonly supported = this.canSynthesize || this.canPlayRecordings;
  readonly autoPlay = signal(this.loadAutoPlay());

  constructor() {
    if (!this.canSynthesize) return;
    // Voices load asynchronously in most browsers.
    this.pickVoice();
    this.synth!.addEventListener?.('voiceschanged', () => this.pickVoice());
  }

  /** Plays the word's recording, falling back to speech when it has none or the recording fails to play. */
  play(word: { foreign: string; audio: string | null }) {
    // Drop anything still playing so a quick card change does not queue up words.
    this.stop();
    if (!word.audio || !this.canPlayRecordings) {
      this.speak(word.foreign);
      return;
    }
    const recording = new Audio(word.audio);
    this.recording = recording;
    recording.play().catch(() => {
      // Only fall back if this is still the word being played.
      if (this.recording === recording) this.speak(word.foreign);
    });
  }

  speak(text: string) {
    if (!this.canSynthesize || !text.trim()) return;
    this.stop();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = LANG;
    if (this.voice) utterance.voice = this.voice;
    utterance.rate = 0.9;
    this.synth!.speak(utterance);
  }

  stop() {
    if (this.canSynthesize) this.synth!.cancel();
    this.recording?.pause();
    this.recording = null;
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
