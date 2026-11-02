import assert from 'node:assert/strict';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import { mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { setup } from './test-support/public-worker.mjs';

const email = 'book-now-customer@example.com';
const password = 'StrongPassword123!';
const nextPassword = 'ChangedPassword456!';
const accessSecret = 'test-access-secret-'.repeat(3);
const control = (ctx, body = {}) => ctx.direct('/__auth-session-test', body);
const claims = token => jwt.decode(token);
const keyFor = session => `auth:refresh:${claims(session.accessToken).userId}:${claims(session.accessToken).sid}`;
const login = async (ctx, selectedPassword = password) => (await ctx.api('/api/v1/auth/login', { body: { email, password: selectedPassword } })).data;
const active = (ctx, session, status = 200) => ctx.api('/api/v1/users/me', { roleToken: session.accessToken, status });
async function refresh(ctx, session, status) {
  const response = await ctx.fetch('https://test/api/v1/auth/refresh-token', {
    method: 'POST', headers: { cookie: `refreshToken=${session.refreshToken}` },
  });
  const body = await response.json();
  if (status !== undefined) assert.equal(response.status, status, JSON.stringify(body));
  return { status: response.status, body };
}
const rotateScript = `if redis.call("GET", KEYS[1]) == "valid" then
  redis.call("DEL", KEYS[1])
  redis.call("SET", KEYS[2], "valid", "EX", ARGV[1])
  return 1
end return 0`;
const deleteScript = `if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1]) end return 0`;

test('S4 login binds access sid to refresh jti; missing, revoked, malformed and expired sessions fail closed', async t => {
  const ctx = await setup(t);
  const session = await login(ctx);
  assert.equal(claims(session.accessToken).sid, claims(session.refreshToken).jti);
  const key = keyFor(session);
  assert.equal((await control(ctx, { operation: 'get', key })).result, 'valid');
  const ttl = (await control(ctx, { operation: 'ttl', key })).result;
  assert.ok(ttl > 0 && ttl <= claims(session.refreshToken).exp - claims(session.refreshToken).iat);
  await active(ctx, session);
  const legacy = jwt.sign({ userId: claims(session.accessToken).userId }, accessSecret, { expiresIn: '5m' });
  await active(ctx, { accessToken: legacy }, 401);
  await control(ctx, { operation: 'set', key, value: 'not-valid', options: { EX: 300 } });
  await active(ctx, session, 401);
  await refresh(ctx, session, 401);
  await control(ctx, { operation: 'set', key, value: 'valid', options: { EX: 300 } });
  await control(ctx, { operation: 'expire', key });
  await active(ctx, session, 401);
  await refresh(ctx, session, 401);
  assert.equal((await control(ctx, { operation: 'get', key })).result, null);
});

test('S4 refresh rotates access and refresh together; concurrent reuse has exactly one winner', async t => {
  const ctx = await setup(t);
  const old = await login(ctx);
  const results = await Promise.all([refresh(ctx, old), refresh(ctx, old)]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 401]);
  const data = results.find(r => r.status === 200).body.data;
  const current = { accessToken: data.accessToken, refreshToken: data.newRefreshToken };
  assert.equal(claims(current.accessToken).sid, claims(current.refreshToken).jti);
  assert.notEqual(claims(current.accessToken).sid, claims(old.accessToken).sid);
  await active(ctx, old, 401);
  await refresh(ctx, old, 401);
  await active(ctx, current);
  assert.equal((await control(ctx, { operation: 'get', key: keyFor(old) })).result, null);
  assert.equal((await control(ctx, { operation: 'get', key: keyFor(current) })).result, 'valid');
});

test('S4 logout revokes only its session; other sessions and users remain active', async t => {
  const ctx = await setup(t);
  const first = await login(ctx), second = await login(ctx);
  await ctx.api('/api/v1/auth/logout', { body: { refreshToken: first.refreshToken }, roleToken: first.accessToken });
  await active(ctx, first, 401);
  await refresh(ctx, first, 401);
  await active(ctx, second);
  await ctx.api('/api/v1/users/me', { roleToken: ctx.managerToken });
});

test('S4 password change invalidates every session of that user without touching other users', async t => {
  const ctx = await setup(t);
  const first = await login(ctx), second = await login(ctx);
  await ctx.api('/api/v1/users/me/password', { method: 'PATCH', roleToken: first.accessToken,
    body: { currentPassword: password, newPassword: nextPassword } });
  for (const session of [first, second]) { await active(ctx, session, 401); await refresh(ctx, session, 401); }
  await ctx.api('/api/v1/users/me', { roleToken: ctx.managerToken });
  await ctx.api('/api/v1/auth/login', { body: { email, password }, status: 401 });
  await active(ctx, await login(ctx, nextPassword));
});

async function prepareReset(ctx) {
  const emailControl = body => ctx.api('/__email-test-control', { body });
  const { brandId } = await emailControl({});
  const root = `/api/v1/brand-email-settings/${brandId}`;
  await ctx.api(root, { method: 'PUT', roleToken: ctx.ownerToken, body: {
    provider: 'GMAIL', fromName: 'Synthetic merchant', fromEmail: 'salon@gmail.com', smtpUsername: 'salon@gmail.com', password: 'abcdefghijklmnop',
  } });
  await ctx.api(root + '/test-email', { roleToken: ctx.ownerToken, body: { recipientEmail: 'synthetic@example.com' } });
  await ctx.api('/api/v1/auth/forgot-password', { body: { email } });
  const { auth } = await emailControl({});
  return (await ctx.api('/api/v1/auth/verify-reset-otp', { body: { email, otp: auth.otp } })).data.resetToken;
}

for (const fault of [null, 'reset-cleanup', 'revoke']) {
  test(`S4 reset revocation and cleanup ordering with storage fault: ${fault ?? 'none'}`, async t => {
    const ctx = await setup(t);
    const first = await login(ctx), second = await login(ctx);
    const resetToken = await prepareReset(ctx);
    await control(ctx, { fault, clearTrace: true });
    const result = await ctx.api('/api/v1/auth/reset-password', { body: { resetToken, newPassword: nextPassword }, status: fault ? 503 : 200 });
    assert.doesNotMatch(JSON.stringify(result), /synthetic internal storage/);
    const { trace } = await control(ctx, { fault: null });
    assert.deepEqual(trace.slice(0, 2), ['revoke', 'reset-token-cleanup']);
    for (const session of [first, second]) {
      await active(ctx, session, fault === 'revoke' ? 200 : 401);
      if (fault !== 'revoke') await refresh(ctx, session, 401);
    }
    await ctx.api('/api/v1/users/me', { roleToken: ctx.managerToken });
    await ctx.api('/api/v1/auth/login', { body: { email, password }, status: 401 });
    await active(ctx, await login(ctx, nextPassword));
    if (!fault) await ctx.api('/api/v1/auth/reset-password', { body: { resetToken, newPassword: 'AnotherPassword123!' }, status: 400 });
    if (fault === 'revoke') {
      // Deliberately prove the remaining cross-store failure risk; do not claim revocation.
      await refresh(ctx, first, 200);
      await ctx.api('/api/v1/auth/reset-password', { body: { resetToken, newPassword: 'AnotherPassword123!' }, status: 400 });
    }
  });
}

test('S4 storage failures return safe 503 for access, login, refresh and logout; no bypass', async t => {
  const ctx = await setup(t);
  const session = await login(ctx);
  await control(ctx, { fault: 'read' });
  const read = await active(ctx, session, 503);
  await control(ctx, { fault: 'write' });
  const write = await ctx.api('/api/v1/auth/login', { body: { email, password }, status: 503 });
  await control(ctx, { fault: 'rotate' });
  const rotated = (await refresh(ctx, session, 503)).body;
  await control(ctx, { fault: 'delete' });
  const deleted = await ctx.api('/api/v1/auth/logout', { body: { refreshToken: session.refreshToken }, roleToken: session.accessToken, status: 503 });
  for (const result of [read, write, rotated, deleted]) {
    assert.match(result.message, /temporarily unavailable/);
    assert.doesNotMatch(JSON.stringify(result), /synthetic internal storage/);
  }
  await control(ctx, { fault: null });
  await active(ctx, session);
});

test('S4 password update/revocation outage returns 503 and exposes the documented residual-session risk', async t => {
  const ctx = await setup(t), session = await login(ctx);
  await control(ctx, { fault: 'revoke' });
  await ctx.api('/api/v1/users/me/password', { method: 'PATCH', roleToken: session.accessToken,
    body: { currentPassword: password, newPassword: nextPassword }, status: 503 });
  await control(ctx, { fault: null });
  await active(ctx, session);
  await active(ctx, await login(ctx, nextPassword));
});

test('S4 real SQLite adapter enforces TTL, NX, exact-valid rotation and compare-delete ownership atomically', async t => {
  const ctx = await setup(t);
  const op = async body => (await control(ctx, body)).result;
  const key = 's4-lock';
  assert.equal(await op({ operation: 'del', key }), 0);
  assert.equal(await op({ operation: 'set', key, value: 'old-owner', options: { NX: true, EX: 300 } }), 'OK');
  assert.equal(await op({ operation: 'set', key, value: 'intruder', options: { NX: true, EX: 10 } }), null);
  assert.ok(await op({ operation: 'ttl', key }) > 290);
  assert.equal(await op({ operation: 'eval', script: deleteScript, options: { keys: [key], arguments: ['intruder'] } }), 0);
  assert.equal(await op({ operation: 'get', key }), 'old-owner');
  await op({ operation: 'expire', key });
  assert.equal(await op({ operation: 'del', key }), 0);
  assert.equal(await op({ operation: 'set', key, value: 'new-owner', options: { NX: true, expiration: { type: 'EX', value: 60 } } }), 'OK');
  assert.equal(await op({ operation: 'eval', script: deleteScript, options: { keys: [key], arguments: ['old-owner'] } }), 0);
  assert.equal(await op({ operation: 'get', key }), 'new-owner');
  assert.equal(await op({ operation: 'eval', script: deleteScript, options: { keys: [key], arguments: ['new-owner'] } }), 1);
  const nx = await op({ operation: 'parallel-set', key, values: ['one', 'two'], options: { NX: true, EX: 60 } });
  assert.equal(nx.filter(v => v === 'OK').length, 1);
  const old = 'auth:refresh:fixture:old';
  const options = [0, 1].map(i => ({ keys: [old, `auth:refresh:fixture:new-${i}`], arguments: ['120'] }));
  await op({ operation: 'set', key: old, value: 'revoked', options: { EX: 60 } });
  assert.equal(await op({ operation: 'eval', script: rotateScript, options: options[0] }), 0);
  await op({ operation: 'set', key: old, value: 'valid', options: { EX: 60 } });
  const results = await op({ operation: 'parallel-eval', script: rotateScript, options });
  assert.deepEqual(results.sort(), [0, 1]);
  assert.equal(await op({ operation: 'get', key: old }), null);
  let winners = 0;
  for (const { keys } of options) {
    if (await op({ operation: 'get', key: keys[1] }) === 'valid') {
      winners++;
      const ttl = await op({ operation: 'ttl', key: keys[1] });
      assert.ok(ttl > 0 && ttl <= 120);
    }
  }
  assert.equal(winners, 1);
  const pairScript = `if redis.call("GET", KEYS[1]) == ARGV[1] then
    redis.call("DEL", KEYS[1]); redis.call("DEL", KEYS[2]) end return 1`;
  await op({ operation: 'set', key: 's4-otp', value: 'new-code', options: { EX: 60 } });
  await op({ operation: 'set', key: 's4-attempts', value: '2', options: { EX: 60 } });
  assert.equal(await op({ operation: 'eval', script: pairScript, options: { keys: ['s4-otp', 's4-attempts'], arguments: ['old-code'] } }), 1);
  assert.equal(await op({ operation: 'get', key: 's4-otp' }), 'new-code');
  assert.equal(await op({ operation: 'get', key: 's4-attempts' }), '2');
  assert.equal(await op({ operation: 'eval', script: pairScript, options: { keys: ['s4-otp', 's4-attempts'], arguments: ['new-code'] } }), 1);
  assert.equal(await op({ operation: 'get', key: 's4-otp' }), null);
  assert.equal(await op({ operation: 'get', key: 's4-attempts' }), null);
});

test('S4 SQLite session revocation survives a disposable Worker restart', async t => {
  const directory = await mkdtemp(path.resolve('node_modules/.cloudflare-test/s4-session-'));
  const ctx = await setup(t, undefined, 'false', directory);
  const session = await login(ctx);
  await ctx.restart();
  await active(ctx, session);
  await ctx.api('/api/v1/auth/logout', { body: { refreshToken: session.refreshToken }, roleToken: session.accessToken });
  await ctx.restart();
  await active(ctx, session, 401);
  await refresh(ctx, session, 401);
});
