import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registerUser, testApp } from './helpers.ts';

test('register logs the user in and /auth/me returns them', async () => {
  const { app } = await testApp();
  const { headers } = await registerUser(app, 'alice');
  const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers });
  assert.equal(me.statusCode, 200);
  assert.deepEqual(me.json(), { id: 1, username: 'alice', sessionSize: 5, fillWithNewWords: false });
});

test('duplicate usernames are rejected case-insensitively', async () => {
  const { app } = await testApp();
  await registerUser(app, 'alice');
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'ALICE', password: 'another-password' },
  });
  assert.equal(res.statusCode, 409);
});

test('register validates username but accepts any password', async () => {
  const { app } = await testApp();
  for (const payload of [
    { username: 'al', password: 'long-enough' },
    { username: 'has space', password: 'long-enough' },
  ]) {
    const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload });
    assert.equal(res.statusCode, 400, JSON.stringify(payload));
  }
  const accented = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'Tamás', password: 'long-enough' },
  });
  assert.equal(accented.statusCode, 201);
  for (const [username, password] of [['shorty', 'x'], ['empty', '']]) {
    const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username, password } });
    assert.equal(res.statusCode, 201, username);
  }
});

test('login accepts the right password only', async () => {
  const { app } = await testApp();
  await registerUser(app, 'alice', 'correct-horse');
  const bad = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username: 'alice', password: 'wrong-horse' },
  });
  assert.equal(bad.statusCode, 401);
  const unknown = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username: 'bob', password: 'correct-horse' },
  });
  assert.equal(unknown.statusCode, 401);
  const good = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username: 'Alice', password: 'correct-horse' },
  });
  assert.equal(good.statusCode, 200);
  assert.ok(good.cookies.some((c) => c.name === 'lw_session' && c.httpOnly));
});

test('protected routes need a session, and logout ends it', async () => {
  const { app } = await testApp();
  for (const url of ['/api/auth/me', '/api/levels', '/api/stats']) {
    const res = await app.inject({ method: 'GET', url });
    assert.equal(res.statusCode, 401, url);
  }
  const { headers } = await registerUser(app);
  const logout = await app.inject({ method: 'POST', url: '/api/auth/logout', headers });
  assert.equal(logout.statusCode, 204);
  const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers });
  assert.equal(me.statusCode, 401);
});

test('settings can be changed within limits', async () => {
  const { app } = await testApp();
  const { headers } = await registerUser(app);
  const ok = await app.inject({
    method: 'PATCH',
    url: '/api/settings',
    headers,
    payload: { sessionSize: 10, fillWithNewWords: true },
  });
  assert.deepEqual(ok.json(), { id: 1, username: 'alice', sessionSize: 10, fillWithNewWords: true });
  const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers });
  assert.deepEqual(me.json(), ok.json());
  const tooBig = await app.inject({
    method: 'PATCH',
    url: '/api/settings',
    headers,
    payload: { sessionSize: 51, fillWithNewWords: false },
  });
  assert.equal(tooBig.statusCode, 400);
  const notBoolean = await app.inject({
    method: 'PATCH',
    url: '/api/settings',
    headers,
    payload: { sessionSize: 5, fillWithNewWords: 'yes' },
  });
  assert.equal(notBoolean.statusCode, 400);
});

test('changing the password needs the current one and logs out other sessions', async () => {
  const { app } = await testApp();
  const { headers } = await registerUser(app, 'alice', 'old-password');
  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username: 'alice', password: 'old-password' },
  });
  const other = login.cookies.find((c) => c.name === 'lw_session')!;
  const otherHeaders = { cookie: `${other.name}=${other.value}` };

  const anonymous = await app.inject({
    method: 'POST',
    url: '/api/auth/password',
    payload: { currentPassword: 'old-password', newPassword: 'new-password' },
  });
  assert.equal(anonymous.statusCode, 401);
  const wrong = await app.inject({
    method: 'POST',
    url: '/api/auth/password',
    headers,
    payload: { currentPassword: 'not-it', newPassword: 'new-password' },
  });
  assert.equal(wrong.statusCode, 403);

  const ok = await app.inject({
    method: 'POST',
    url: '/api/auth/password',
    headers,
    payload: { currentPassword: 'old-password', newPassword: 'new-password' },
  });
  assert.equal(ok.statusCode, 204);
  const fresh = ok.cookies.find((c) => c.name === 'lw_session')!;
  const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: `${fresh.name}=${fresh.value}` } });
  assert.equal(me.statusCode, 200);
  for (const h of [headers, otherHeaders]) {
    const res = await app.inject({ method: 'GET', url: '/api/auth/me', headers: h });
    assert.equal(res.statusCode, 401);
  }

  for (const [password, status] of [['old-password', 401], ['new-password', 200]] as const) {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'alice', password } });
    assert.equal(res.statusCode, status, password);
  }
});
