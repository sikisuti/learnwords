import { Component, inject, input, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { errorMessage } from '../core/api.service';
import { AuthService } from '../core/auth.service';

/** Login and registration share one form; the route decides which one it is. */
@Component({
  selector: 'app-auth-page',
  imports: [ReactiveFormsModule, RouterLink],
  template: `
    <div class="page auth">
      <div class="brand">
        <div class="logo" aria-hidden="true">Aa</div>
        <h1>Learn Words</h1>
        <p class="muted">{{ mode() === 'login' ? 'Log in to continue learning.' : 'Create an account to start learning.' }}</p>
      </div>

      <form class="panel" [formGroup]="form" (ngSubmit)="submit()">
        <label class="field">
          <span>Username</span>
          <input formControlName="username" autocomplete="username" autocapitalize="none" spellcheck="false" />
          @if (mode() === 'register') {
            <small>3–32 letters, numbers, dots, dashes or underscores.</small>
          }
        </label>
        <label class="field">
          <span>Password</span>
          <input
            type="password"
            formControlName="password"
            [attr.autocomplete]="mode() === 'login' ? 'current-password' : 'new-password'"
          />
          @if (mode() === 'register') {
            <small>At least 8 characters.</small>
          }
        </label>
        @if (mode() === 'register') {
          <label class="field">
            <span>Repeat password</span>
            <input type="password" formControlName="repeat" autocomplete="new-password" />
          </label>
        }
        @if (error()) {
          <p class="error" role="alert">{{ error() }}</p>
        }
        <button class="btn primary block" type="submit" [disabled]="busy()">
          {{ mode() === 'login' ? 'Log in' : 'Create account' }}
        </button>
      </form>

      <p class="switch">
        @if (mode() === 'login') {
          New here? <a routerLink="/register">Create an account</a>
        } @else {
          Already registered? <a routerLink="/login">Log in</a>
        }
      </p>
    </div>
  `,
  styles: `
    .auth {
      justify-content: center;
    }
    .brand {
      text-align: center;
    }
    .logo {
      width: 64px;
      height: 64px;
      margin: 0 auto 12px;
      display: grid;
      place-items: center;
      border-radius: 18px;
      background: var(--primary);
      color: var(--primary-text);
      font-size: 1.6rem;
      font-weight: 800;
    }
    .switch {
      text-align: center;
    }
  `,
})
export class AuthPage {
  readonly mode = input.required<'login' | 'register'>();

  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly form = inject(FormBuilder).nonNullable.group({
    username: ['', Validators.required],
    password: ['', Validators.required],
    repeat: [''],
  });

  protected async submit() {
    const { username, password, repeat } = this.form.getRawValue();
    const name = username.trim();
    if (!name || !password) {
      this.error.set('Enter your username and password.');
      return;
    }
    if (this.mode() === 'register') {
      if (!/^[\p{L}\p{N}._-]{3,32}$/u.test(name)) {
        this.error.set('The username must be 3–32 letters, numbers, dots, dashes or underscores.');
        return;
      }
      if (password.length < 8) {
        this.error.set('The password must be at least 8 characters long.');
        return;
      }
      if (password !== repeat) {
        this.error.set('The passwords do not match.');
        return;
      }
    }
    this.busy.set(true);
    this.error.set('');
    try {
      if (this.mode() === 'login') await this.auth.login(name, password);
      else await this.auth.register(name, password);
      await this.router.navigateByUrl('/');
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
