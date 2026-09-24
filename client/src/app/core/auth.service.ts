import { HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { ApiService } from './api.service';
import type { User } from './models';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly api = inject(ApiService);
  private loaded: Promise<User | null> | null = null;

  readonly user = signal<User | null>(null);

  /** Loads the logged-in user once per page load. */
  load(): Promise<User | null> {
    this.loaded ??= this.api.me().then(
      (user) => this.set(user),
      () => this.set(null),
    );
    return this.loaded;
  }

  set(user: User | null): User | null {
    this.user.set(user);
    this.loaded = Promise.resolve(user);
    return user;
  }

  async login(username: string, password: string) {
    return this.set(await this.api.login(username, password));
  }

  async register(username: string, password: string) {
    return this.set(await this.api.register(username, password));
  }

  async logout() {
    try {
      await this.api.logout();
    } finally {
      this.set(null);
    }
  }
}

export const authGuard: CanActivateFn = async () => {
  const user = await inject(AuthService).load();
  return user ? true : inject(Router).parseUrl('/login');
};

/** Keeps logged-in users away from the login and register pages. */
export const guestGuard: CanActivateFn = async () => {
  const user = await inject(AuthService).load();
  return user ? inject(Router).parseUrl('/') : true;
};

/** Sends the user to the login page when their session has expired. */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return next(req).pipe(
    catchError((err: unknown) => {
      if (err instanceof HttpErrorResponse && err.status === 401 && !req.url.startsWith('/api/auth/')) {
        auth.set(null);
        void router.navigateByUrl('/login');
      }
      return throwError(() => err);
    }),
  );
};
