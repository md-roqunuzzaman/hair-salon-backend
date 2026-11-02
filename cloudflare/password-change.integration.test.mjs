import assert from 'node:assert/strict';
import test from 'node:test';
import { setup } from './test-support/public-worker.mjs';

const email = 'book-now-manager@example.com';
const password = 'StrongPassword123!';
const nextPassword = 'ChangedPassword456!';
async function requiredLogin(ctx) {
  await ctx.direct('/__login-rate-test', { passwordRequiredUser: email });
  const result = await ctx.api('/api/v1/auth/login', { body: { email, password } });
  assert.equal(result.data.user.mustChangePassword, true);
  assert.equal(result.data.user.role, 'BRANCH_MANAGER');
  return result.data;
}
const oldRefresh = (ctx, token) => ctx.fetch('https://test/api/v1/auth/refresh-token', {
  method: 'POST', headers: { cookie: `refreshToken=${token}` },
});

test('required password change: restricted session can change its own password and re-login', async t => {
  const ctx = await setup(t);
  const session = await requiredLogin(ctx);
  const blocked = await ctx.api('/api/v1/users/me', { roleToken: session.accessToken, status: 403 });
  assert.match(blocked.message, /Password change required/);
  await ctx.api('/api/v1/users/me', { method: 'PATCH', body: { name: 'Forbidden early edit' }, roleToken: session.accessToken, status: 403 });
  await ctx.api('/api/v1/users/me/password', { method: 'PATCH', body: { currentPassword: 'WrongPassword123!', newPassword: nextPassword }, roleToken: session.accessToken, status: 401 });
  await ctx.api('/api/v1/users/me/password', { method: 'PATCH', body: { currentPassword: password, newPassword: password }, roleToken: session.accessToken, status: 400 });
  await ctx.api('/api/v1/users/me', { roleToken: session.accessToken, status: 403 });
  const changed = await ctx.api('/api/v1/users/me/password', { method: 'PATCH', body: { currentPassword: password, newPassword: nextPassword }, roleToken: session.accessToken });
  assert.equal(changed.message, 'Password changed successfully');
  assert.equal(changed.data, null);
  await ctx.api('/api/v1/users/me', { roleToken: session.accessToken, status: 401 });
  const revoked = await oldRefresh(ctx, session.refreshToken);
  assert.equal(revoked.status, 401);
  await revoked.text();
  await ctx.api('/api/v1/auth/login', { body: { email, password }, status: 401 });
  const login = await ctx.api('/api/v1/auth/login', { body: { email, password: nextPassword } });
  assert.equal(login.data.user.mustChangePassword, false);
  assert.equal(login.data.user.role, 'BRANCH_MANAGER');
  await ctx.api('/api/v1/users/me', { roleToken: login.data.accessToken });
});

test('required password change: logout exception stays authenticated and revokes refresh session', async t => {
  const ctx = await setup(t);
  const session = await requiredLogin(ctx);
  await ctx.api('/api/v1/auth/logout', { body: { refreshToken: session.refreshToken }, roleToken: null, status: 401 });
  await ctx.api('/api/v1/auth/logout', { body: { refreshToken: session.refreshToken }, roleToken: session.accessToken });
  await ctx.api('/api/v1/users/me', { roleToken: session.accessToken, status: 401 });
  const revoked = await oldRefresh(ctx, session.refreshToken);
  assert.equal(revoked.status, 401);
  await revoked.text();
});

test('required password change: concurrent requests cannot both replace the same original password', async t => {
  const ctx = await setup(t);
  const session = await requiredLogin(ctx);
  const candidates = ['ConcurrentPassword123!', 'ConcurrentPassword456!'];
  const results = await Promise.all(candidates.map(async newPassword => {
    const response = await ctx.fetch('https://test/api/v1/users/me/password', {
      method: 'PATCH', headers: { 'content-type': 'application/json', authorization: `Bearer ${session.accessToken}` },
      body: JSON.stringify({ currentPassword: password, newPassword }),
    });
    const body = await response.json();
    assert.equal(body.statusCode, response.status);
    return { newPassword, status: response.status };
  }));
  assert.equal(results.filter(result => result.status === 200).length, 1);
  assert.equal(results.filter(result => [401, 409].includes(result.status)).length, 1);
  const winner = results.find(result => result.status === 200);
  const loser = results.find(result => result.status !== 200);
  await ctx.api('/api/v1/auth/login', { body: { email, password: loser.newPassword }, status: 401 });
  const login = await ctx.api('/api/v1/auth/login', { body: { email, password: winner.newPassword } });
  assert.equal(login.data.user.mustChangePassword, false);
});
