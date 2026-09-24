import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService, errorMessage } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { ToastService } from '../core/toast.service';

@Component({
  selector: 'app-settings-page',
  imports: [FormsModule, RouterLink],
  template: `
    <div class="page">
      <header class="topbar">
        <a class="btn icon" routerLink="/" aria-label="Back">←</a>
        <h1>Settings</h1>
      </header>

      <form class="panel" (ngSubmit)="save()">
        <label class="field">
          <span>Words to learn per session</span>
          <input type="number" name="size" min="1" max="50" inputmode="numeric" [(ngModel)]="size" />
          <small>Each session also mixes in up to 8 words you already know, one per turn.</small>
        </label>
        @if (error()) {
          <p class="error" role="alert">{{ error() }}</p>
        }
        <button class="btn primary block" type="submit" [disabled]="busy()">Save</button>
      </form>
    </div>
  `,
})
export class SettingsPage {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);

  protected size = this.auth.user()!.sessionSize;
  protected readonly busy = signal(false);
  protected readonly error = signal('');

  protected async save() {
    const size = Number(this.size);
    if (!Number.isInteger(size) || size < 1 || size > 50) {
      this.error.set('Choose a whole number from 1 to 50.');
      return;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      this.auth.set(await this.api.updateSettings(size));
      this.toast.show('Settings saved.');
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
