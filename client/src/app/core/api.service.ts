import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { AddResult, Deck, Level, SearchHit, Stats, User, WordInput } from './models';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);

  me = () => firstValueFrom(this.http.get<User>('/api/auth/me'));
  login = (username: string, password: string) =>
    firstValueFrom(this.http.post<User>('/api/auth/login', { username, password }));
  register = (username: string, password: string) =>
    firstValueFrom(this.http.post<User>('/api/auth/register', { username, password }));
  logout = () => firstValueFrom(this.http.post<void>('/api/auth/logout', {}));

  updateSettings = (sessionSize: number) => firstValueFrom(this.http.patch<User>('/api/settings', { sessionSize }));
  stats = () => firstValueFrom(this.http.get<Stats>('/api/stats'));
  levels = () => firstValueFrom(this.http.get<Level[]>('/api/levels'));

  search = (q: string) => this.http.get<SearchHit[]>('/api/words/search', { params: { q } });
  addWord = (word: WordInput) => firstValueFrom(this.http.post<AddResult>('/api/words', word));
  learnWord = (id: number) => firstValueFrom(this.http.post<AddResult>(`/api/words/${id}/learn`, {}));

  startSession = () => firstValueFrom(this.http.post<Deck>('/api/sessions', {}));
  completeSession = (body: { issuedAt: string; learnIds: number[]; knownIds: number[] }) =>
    firstValueFrom(this.http.post<{ advanced: number; reviewed: number }>('/api/sessions/complete', body));
}

/** A readable message for a failed request. */
export function errorMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (err instanceof HttpErrorResponse) {
    if (err.status === 0) return 'Cannot reach the server. Check your connection.';
    if (typeof err.error?.error === 'string') return err.error.error;
    if (err.status === 429) return 'Too many attempts. Wait a minute and try again.';
    if (err.status === 400 && typeof err.error?.message === 'string') return err.error.message;
  }
  return fallback;
}
