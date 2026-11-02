import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setup } from './test-support/public-worker.mjs';

const password = 'StrongPassword123!';
const wrongPassword = 'IncorrectPassword123!';
const email = 'book-now-customer@example.com';
const key = (type, value) => `rate-limit:login:${type}:${createHash('sha256').update(value).digest('hex')}`;
const inspect = ctx => ctx.direct('/__login-rate-test', {});
const login = (ctx, { account = email, secret = wrongPassword, ip = '198.51.100.20', status = 401 } = {}) =>
  ctx.api('/api/v1/auth/login', { body: { email: account, password: secret }, clientIp: ip, status });
const rawLogin = (ctx, headers = {}) => ctx.fetch('https://test/api/v1/auth/login', {
  method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '198.51.100.20', ...headers },
  body: JSON.stringify({ email, password: wrongPassword }),
});

test('Workers login: normalized account budget survives IP changes, blocks at ten and expires', async t => {
  const ctx = await setup(t);
  for (let i = 0; i < 10; i++) await login(ctx, { account: i % 2 ? email.toUpperCase() : email, ip: `198.51.100.${40 + i}` });
  await login(ctx, { secret: password, ip: '198.51.100.60', status: 429 });
  const snapshot = await inspect(ctx);
  const account = snapshot.counters.find(row => row.key === key('account', email));
  assert.equal(account.value, '10');
  assert.ok(account.expires > Date.now());
  assert.ok(account.expires <= Date.now() + 900_000);
  await ctx.direct('/__login-rate-test', { expire: true });
  const result = await login(ctx, { secret: password, status: 200 });
  assert.ok(result.data.accessToken);
  assert.equal((await inspect(ctx)).counters.some(row => row.key === key('account', email)), false);
});

test('Workers login: IP budget spans accounts and cannot be bypassed using forwarded headers', async t => {
  const ctx = await setup(t);
  for (let i = 0; i < 30; i++) await login(ctx, { account: `absent-${i}@example.com` });
  const before = await inspect(ctx);
  const ipCounter = before.counters.find(row => row.key === key('ip', '198.51.100.20'));
  assert.equal(ipCounter.value, '30');
  await login(ctx, { account: 'absent-last@example.com', status: 429 });
  assert.deepEqual((await inspect(ctx)).counters, before.counters, 'Blocked attempts neither increment nor extend TTLs');

  const spoofed = await rawLogin(ctx, { 'x-forwarded-for': '203.0.113.200', 'x-real-ip': '203.0.113.201' });
  assert.equal(spoofed.status, 429);
  assert.ok(Number(spoofed.headers.get('Retry-After')) > 0);
  await spoofed.text();
  await login(ctx, { account: 'absent-last@example.com', ip: '198.51.100.21' });
});

test('Workers login: concurrent requests atomically reserve ten attempts without overshoot', async t => {
  const ctx = await setup(t);
  const results = await Promise.all(Array.from({ length: 16 }, async () => {
    const response = await rawLogin(ctx);
    const data = await response.json();
    assert.ok([401, 429].includes(response.status));
    assert.equal(data.statusCode, response.status);
    return data;
  }));
  assert.equal(results.filter(result => result.statusCode === 401).length, 10);
  assert.equal(results.filter(result => result.statusCode === 429).length, 6);
  const rows = (await inspect(ctx)).counters;
  assert.equal(rows.find(row => row.key === key('account', email)).value, '10');
  assert.equal(rows.find(row => row.key === key('ip', '198.51.100.20')).value, '10');
});

test('Workers login: successful authentication resets account only and preserves session contract', async t => {
  const ctx = await setup(t);
  for (let i = 0; i < 9; i++) await login(ctx);
  const result = await login(ctx, { secret: password, status: 200 });
  assert.ok(result.data.accessToken);
  assert.ok(result.data.refreshToken);
  const snapshot = await inspect(ctx);
  assert.equal(snapshot.counters.some(row => row.key === key('account', email)), false);
  assert.equal(snapshot.counters.find(row => row.key === key('ip', '198.51.100.20')).value, '10');
  await ctx.api('/api/v1/users/me', { roleToken: result.data.accessToken });
  for (let i = 0; i < 10; i++) await login(ctx);
  await login(ctx, { status: 429 });
});

test('Workers login: malformed input and missing trusted IP consume no attempts', async t => {
  const ctx = await setup(t);
  const before = await inspect(ctx);
  await ctx.api('/api/v1/auth/login', { body: { email, password: 'bad' }, status: 400 });
  await ctx.api('/api/v1/auth/login', { body: { email, password }, clientIp: '', status: 400 });
  assert.deepEqual((await inspect(ctx)).counters, before.counters);
});

test('Workers login: durable rate limits survive Worker restart', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'salon-login-'));
  // The fixture disposes workerd before this final cleanup hook.
  const ctx = await setup(t, undefined, 'false', directory);
  for (let i = 0; i < 10; i++) await login(ctx);
  await ctx.restart();
  await login(ctx, { status: 429 });
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
    await rm(directory, { recursive: true, force: true });
  });
});

test('Workers login: account cleanup failure returns 503 and removes newly created refresh session', async t => {
  const ctx = await setup(t);
  const before = await ctx.direct('/__login-rate-test', { failAccountDelete: true });
  await login(ctx, { secret: password, status: 503 });
  assert.equal((await inspect(ctx)).refreshSessions, before.refreshSessions);
});
