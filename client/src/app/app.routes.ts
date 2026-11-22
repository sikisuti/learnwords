import type { Routes } from '@angular/router';
import { authGuard, guestGuard } from './core/auth.service';

export const routes: Routes = [
  {
    path: 'login',
    canActivate: [guestGuard],
    data: { mode: 'login' },
    title: 'Log in · Learn Words',
    loadComponent: () => import('./pages/auth-page').then((m) => m.AuthPage),
  },
  {
    path: 'register',
    canActivate: [guestGuard],
    data: { mode: 'register' },
    title: 'Register · Learn Words',
    loadComponent: () => import('./pages/auth-page').then((m) => m.AuthPage),
  },
  {
    path: '',
    canActivateChild: [authGuard],
    children: [
      { path: '', title: 'Learn Words', loadComponent: () => import('./pages/home-page').then((m) => m.HomePage) },
      {
        path: 'learn',
        title: 'Learning · Learn Words',
        loadComponent: () => import('./learn/learn-page').then((m) => m.LearnPage),
      },
      {
        path: 'test',
        title: 'Test my words · Learn Words',
        loadComponent: () => import('./pages/test-select-page').then((m) => m.TestSelectPage),
      },
      {
        path: 'test/run',
        title: 'Test · Learn Words',
        loadComponent: () => import('./learn/test-page').then((m) => m.TestPage),
      },
      {
        path: 'add',
        title: 'Add a word · Learn Words',
        loadComponent: () => import('./pages/add-word-page').then((m) => m.AddWordPage),
      },
      {
        path: 'settings',
        title: 'Settings · Learn Words',
        loadComponent: () => import('./pages/settings-page').then((m) => m.SettingsPage),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
