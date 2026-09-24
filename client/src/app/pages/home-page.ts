import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import type { Stats } from '../core/models';
import { clearSession, completedPasses, loadSession, TOTAL_PASSES } from '../learn/learning-session';

@Component({
  selector: 'app-home-page',
  imports: [RouterLink],
  template: `
    <div class="page">
      <header class="topbar">
        <h1>Learn Words</h1>
        <a class="btn icon" routerLink="/settings" aria-label="Settings">⚙</a>
      </header>

      <section class="panel hello">
        <p class="muted">Logged in as</p>
        <p class="name">{{ auth.user()?.username }}</p>
        @if (stats(); as s) {
          <div class="stats">
            <div><strong>{{ s.due }}</strong><span>due now</span></div>
            <div><strong>{{ s.learning }}</strong><span>learning</span></div>
            <div><strong>{{ s.known }}</strong><span>known</span></div>
          </div>
        }
      </section>

      @if (savedProgress() !== null) {
        <a class="btn primary big block" routerLink="/learn">Resume learning ({{ savedProgress() }}%)</a>
        <button class="btn link" (click)="discard()">Discard the unfinished session</button>
      } @else {
        <a class="btn primary big block" routerLink="/learn">Start learning</a>
      }
      <a class="btn big block" routerLink="/add">＋ Add a word</a>

      <button class="btn link logout" (click)="logout()">Log out</button>
    </div>
  `,
  styles: `
    .hello p {
      margin: 0;
    }
    .name {
      font-size: 1.5rem;
      font-weight: 700;
    }
    .stats {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
      margin-top: 16px;
      text-align: center;
      div {
        padding: 10px 4px;
        border-radius: 12px;
        background: var(--surface-2);
      }
      strong {
        display: block;
        font-size: 1.4rem;
      }
      span {
        font-size: 0.8rem;
        color: var(--muted);
      }
    }
    .logout {
      margin-top: auto;
    }
  `,
})
export class HomePage {
  protected readonly auth = inject(AuthService);
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);

  protected readonly stats = signal<Stats | null>(null);
  protected readonly savedProgress = signal<number | null>(this.readSavedProgress());

  constructor() {
    this.api.stats().then(
      (stats) => this.stats.set(stats),
      () => undefined,
    );
  }

  private readSavedProgress(): number | null {
    const saved = loadSession(this.auth.user()!.id);
    return saved ? Math.round((completedPasses(saved) / TOTAL_PASSES) * 100) : null;
  }

  protected discard() {
    if (!confirm('Discard the unfinished session? The words stay at their current stage.')) return;
    clearSession(this.auth.user()!.id);
    this.savedProgress.set(null);
  }

  protected async logout() {
    await this.auth.logout();
    await this.router.navigateByUrl('/login');
  }
}
