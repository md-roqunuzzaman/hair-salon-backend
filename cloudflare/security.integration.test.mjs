import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID, randomBytes, createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { setup } from './test-support/public-worker.mjs';

import { safeResult as safe, flaggedResult as flagged, reviewResult, valid } from './test-support/tencent-responses.mjs';
const control = (ctx, body = {}) => ctx.direct('/__security-test-control', body);
function redacted(value, markers) {
  const text = JSON.stringify(value);
  assert.ok(markers.every(marker => !text.includes(marker)), 'Synthetic secret leaked (values suppressed)');
}
function securityHeaders(response) {
  for (const [name, value] of Object.entries({
    'x-content-type-options': 'nosniff', 'x-frame-options': 'SAMEORIGIN',
    'referrer-policy': 'no-referrer', 'strict-transport-security': 'max-age=31536000; includeSubDomains',
    'cross-origin-opener-policy': 'same-origin',
  })) assert.equal(response.headers.get(name), value, name);
  for (const name of ['x-powered-by', 'content-security-policy', 'cross-origin-resource-policy']) assert.equal(response.headers.get(name), null, name);
}
async function completedReview(ctx, moderationResponse = valid(safe)) {
  const { appointmentId } = await control(ctx, { seedAppointment: ctx.fixture, moderationResponse, providerFailure: false });
  return (await ctx.api(`/api/v1/appointments/${appointmentId}/reviews`, { body: { rating: 5, comment: 'Synthetic customer feedback' }, status: 201 })).data;
}

test('Worker S5 enforces the 72 UTF-8 byte boundary for registration/change/reset without changing the current password', async t => {
  const ctx = await setup(t);
  await control(ctx);
  const oversized = ['Aa1!' + 'A'.repeat(69), 'Aa1!' + '😀'.repeat(18)];
  for (const password of oversized) {
    const registration = await ctx.api('/api/v1/auth/register', { body: { name: 'Synthetic boundary customer', email: 'security-over-limit@example.com', password }, status: 400 });
    assert.equal(registration.message, 'Password must not exceed 72 UTF-8 bytes');
    const changed = await ctx.api('/api/v1/users/me/password', { method: 'PATCH', body: { currentPassword: 'StrongPassword123!', newPassword: password }, status: 400 });
    assert.equal(changed.message, 'Password must not exceed 72 UTF-8 bytes');
    const reset = await ctx.api('/api/v1/auth/reset-password', { body: { resetToken: 'synthetic-unused-reset-token', newPassword: password }, status: 400 });
    assert.equal(reset.message, 'Password must not exceed 72 UTF-8 bytes');
  }
  await ctx.api('/api/v1/users/me');
  const password = 'Aa1!' + 'A'.repeat(68);
  const registered = await ctx.api('/api/v1/auth/register', { body: { name: 'Synthetic boundary customer', email: 'security-72@example.com', password }, status: 201 });
  assert.equal(registered.data.emailVerified, false);
  await ctx.api('/api/v1/auth/login', { body: { email: 'security-72@example.com', password }, status: 403 });
  const provider = await ctx.api('/__email-test-control', { body: {} });
  assert.equal(provider.smtp.length, 0);
});

test('Worker S6 real SQLite create/update fail closed for malformed results and preserve safe/flagged behavior', async t => {
  const ctx = await setup(t);
  const cases = [
    [valid(safe), 'VISIBLE'], [valid(flagged), 'HIDDEN'],
    [valid({ ...safe, Suggestion: false }), 'PENDING'],
    [valid({}), 'PENDING'], [valid({ ...safe, Label: null }), 'PENDING'],
    [valid({ ...safe, Score: '0' }), 'PENDING'],
    [valid({ ...safe, DetailResults: [safe, flagged] }), 'PENDING'],
    [valid({ ...safe, LabelResults: [safe, { ...safe, Suggestion: 0 }] }), 'PENDING'],
    [valid({ ...flagged, LabelResults: [safe, flagged] }), 'HIDDEN'],
    [valid({ ...safe, LibResults: [flagged] }), 'PENDING'],
    [valid({ ...safe, LibResults: [{ ...safe, Score: false }] }), 'PENDING'],
  ];
  for (const [moderationResponse, expected] of cases) {
    const created = await completedReview(ctx, moderationResponse);
    assert.equal(created.moderationStatus, expected);
    const updated = await ctx.api(`/api/v1/reviews/${created.id}`, { method: 'PATCH', body: { comment: 'Updated synthetic feedback' } });
    assert.equal(updated.data.moderationStatus, expected);
    const saved = (await control(ctx, { reviewId: created.id })).review;
    assert.equal(saved.moderationStatus, expected);
    if (expected === 'PENDING') assert.equal(saved.moderationReason, 'Moderation service unavailable');
  }
  const manual = await completedReview(ctx, valid(reviewResult));
  assert.equal(manual.moderationStatus, 'PENDING');
  assert.equal(manual.moderationReason, 'Abuse');
  assert.equal((await completedReview(ctx, valid({ ...safe, DetailResults: null, LabelResults: [] }))).moderationStatus, 'VISIBLE');
  assert.equal((await completedReview(ctx, valid({ ...safe, LibResults: [{ ...safe, SubLabel: null }] }))).moderationStatus, 'VISIBLE');
  const review = await completedReview(ctx);
  await control(ctx, { providerFailure: true });
  const result = await ctx.api(`/api/v1/reviews/${review.id}`, { method: 'PATCH', body: { comment: 'Network failure feedback' } });
  assert.equal(result.data.moderationStatus, 'PENDING');
  assert.equal((await control(ctx, { reviewId: review.id })).review.moderationStatus, 'PENDING');
  assert.equal((await control(ctx)).blockedProviderCalls, 0, 'Moderation must use the mock without attempting network I/O');
});

test('Worker S6 owner/manager reply failures return safe 503 and never overwrite the persisted moderated reply', async t => {
  const ctx = await setup(t);
  const review = await completedReview(ctx);
  await ctx.api(`/api/v1/reviews/${review.id}/reply`, { method: 'PUT', roleToken: ctx.ownerToken, body: { reply: 'Previously moderated reply' } });
  const before = await control(ctx, { reviewId: review.id });
  for (const roleToken of [ctx.ownerToken, ctx.managerToken]) {
    for (const providerFailure of [false, true]) {
      await control(ctx, { moderationResponse: valid({ ...safe, Suggestion: false }), providerFailure });
      const failure = await ctx.api(`/api/v1/reviews/${review.id}/reply`, {
        method: 'PUT', roleToken, body: { reply: 'Unmoderated replacement' }, status: 503,
      });
      assert.equal(failure.message, 'REVIEW_REPLY_MODERATION_UNAVAILABLE');
      redacted(failure, ['synthetic provider diagnostic', roleToken]);
      const after = await control(ctx, { reviewId: review.id });
      assert.equal(after.review.replyText, 'Previously moderated reply');
      assert.equal(after.notificationCount, before.notificationCount);
    }
  }
  await control(ctx, { moderationResponse: valid(flagged), providerFailure: false });
  await ctx.api(`/api/v1/reviews/${review.id}/reply`, { method: 'PUT', roleToken: ctx.ownerToken, body: { reply: 'Flagged replacement' }, status: 422 });
  assert.equal((await control(ctx, { reviewId: review.id })).review.replyText, 'Previously moderated reply');
  await control(ctx, { moderationResponse: valid(reviewResult), providerFailure: false });
  await ctx.api(`/api/v1/reviews/${review.id}/reply`, { method: 'PUT', roleToken: ctx.ownerToken, body: { reply: 'Manual review replacement' }, status: 422 });
  assert.equal((await control(ctx, { reviewId: review.id })).review.replyText, 'Previously moderated reply');
});

test('Worker S6 nullable Tencent metadata permits approved owner/manager replies and blocks unsafe edits', async t => {
  const ctx = await setup(t);
  const review = await completedReview(ctx);
  for (const roleToken of [ctx.ownerToken, ctx.managerToken]) {
    await control(ctx, { moderationResponse: valid({ ...safe, SubLabel: null,
      DetailResults: [{ Label: '', SubLabel: null, Suggestion: 'Pass', Score: 0 }] }), providerFailure: false });
    await ctx.api(`/api/v1/reviews/${review.id}/reply`, { method: 'PUT', roleToken, body: { reply: 'Approved nullable metadata reply' } });
    assert.equal((await control(ctx, { reviewId: review.id })).review.replyText, 'Approved nullable metadata reply');
    for (const Suggestion of ['Review', 'Block']) {
      await control(ctx, { moderationResponse: valid({ ...safe, SubLabel: null, Suggestion }) });
      await ctx.api(`/api/v1/reviews/${review.id}/reply`, { method: 'PUT', roleToken, body: { reply: 'Synthetic unsafe replacement' }, status: 422 });
      assert.equal((await control(ctx, { reviewId: review.id })).review.replyText, 'Approved nullable metadata reply');
    }
  }
});

test('Worker S6 manual moderation reason reaches customer notification messages in all three languages', async t => {
  const ctx = await setup(t);
  const review = await completedReview(ctx);
  const reason = 'Please remove personal contact details.';
  await ctx.api(`/api/v1/reviews/${review.id}/moderation`, { method: 'PATCH', roleToken: ctx.ownerToken,
    body: { moderationStatus: 'HIDDEN', reason } });
  const token = (await ctx.api('/api/v1/auth/login', { body: { email: 'book-now-customer@example.com', password: 'StrongPassword123!' } })).data.accessToken;
  for (const lang of ['en', 'zh-CN', 'zh-HK']) {
    const response = await ctx.fetch('https://test/api/v1/notifications', { headers: { authorization: 'Bearer ' + token, 'accept-language': lang } });
    assert.equal(response.status, 200);
    const notice = (await response.json()).data.items.find(row => row.type === 'REVIEW_NEEDS_CHANGES');
    assert.ok(notice.message.includes(reason));
    assert.ok(notice.message.includes(lang === 'en' ? 'Reason: ' : '原因：'));
  }
});

test('Worker booking-policy PUT remains owner-only under the confirmed permission contract', async t => {
  const ctx = await setup(t);
  const before = await ctx.api(`/api/v1/branches/${ctx.fixture.branchId}/booking-policy`);
  await ctx.api(`/api/v1/branches/${ctx.fixture.branchId}/booking-policy`, { method: 'PUT', body: {}, roleToken: ctx.managerToken, status: 403 });
  assert.deepEqual(await ctx.api(`/api/v1/branches/${ctx.fixture.branchId}/booking-policy`), before);
});

test('Worker S7 actual request logs redact query/OAuth/header/cookie/body markers across real HTTP routes', async t => {
  const ctx = await setup(t);
  const markers = Array.from({ length: 7 }, () => randomUUID());
  const state = randomBytes(32).toString('base64url');
  const query = new URLSearchParams({ code: markers[0], state, access_token: markers[1], refresh_token: markers[2], password: markers[3] });
  await control(ctx, { capture: true, clearLogs: true });
  const headers = { authorization: `Bearer ${markers[4]}`, cookie: `accessToken=${markers[5]}`, 'content-type': 'application/json' };
  for (const [path, init, status] of [
    [`/?${query}`, { headers }, 200],
    [`/__security-missing?${query}`, { method: 'POST', headers, body: JSON.stringify({ private: markers[6] }) }, 404],
    [`/api/v1/branches/${ctx.fixture.branchId}/appointments?${query}`, {}, 401],
    [`/api/v1/availability?${query}&branchId=11111111-1111-4111-8111-111111111111&serviceId=${ctx.fixture.serviceId}&date=${ctx.fixture.date}`, {}, 404],
    [`/api/v1/brand-email-settings/microsoft/callback?${new URLSearchParams({ code: markers[0], state })}`, {}, 400],
  ]) {
    const response = await ctx.fetch('https://test' + path, init);
    assert.equal(response.status, status);
    await response.text();
  }
  const { logs } = await control(ctx, {});
  redacted(logs, [...markers, state]);
  assert.ok(logs.some(args => args[0] === 'METHOD:' && args[1] === 'GET'));
  assert.ok(logs.some(args => args[0] === 'PATH:' && args[1] === '/api/v1/brand-email-settings/microsoft/callback'));
  assert.ok(logs.some(args => args[0] === 'TIME:' && /^\d{4}-\d{2}-\d{2}T/.test(args[1])));
  await control(ctx, { capture: false, clearLogs: true });
});

test('Worker S8 security headers/CORS survive actual API errors, preflight and raw signed Stripe webhooks', async t => {
  const ctx = await setup(t);
  for (const [path, init, status] of [
    ['/', {}, 200], ['/api/v1/__missing', {}, 404], ['/api/v1/users/me', {}, 401],
    ['/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' }, 400],
    ['/api/v1/payments/stripe/webhook', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }, 400],
    ['/api/v1/auth/login', { method: 'OPTIONS', headers: { 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,content-type' } }, 204],
  ]) {
    const response = await ctx.fetch('https://test' + path, { ...init, headers: { origin: 'https://frontend.example.com', ...init.headers } });
    assert.equal(response.status, status); securityHeaders(response);
    assert.equal(response.headers.get('access-control-allow-origin'), 'https://frontend.example.com');
    assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
    await response.text();
  }
  const payload = ' {\n "id": "evt_security_worker", "type": "account.updated", "data": { "object": {} }\n } ';
  const time = Math.floor(Date.now() / 1000);
  const signature = createHmac('sha256', 'whsec_test').update(`${time}.${payload}`).digest('hex');
  const send = body => ctx.fetch('https://test/api/v1/payments/stripe/webhook', { method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': `t=${time},v1=${signature}` }, body });
  const accepted = await send(payload);
  assert.equal(accepted.status, 200); securityHeaders(accepted);
  assert.deepEqual(await accepted.json(), { received: true });
  const before = await control(ctx);
  const tampered = await send(payload.replace('account.updated', 'account.changed'));
  assert.equal(tampered.status, 400); securityHeaders(tampered);
  assert.equal((await tampered.json()).message, 'Invalid Stripe webhook signature');
  assert.equal((await control(ctx)).webhookEventCount, before.webhookEventCount);
});

test('Production Worker source map matches current S4/S6/S7/S8 source and excludes every security test control', async () => {
  const map = JSON.parse(await readFile('cloudflare/.build/worker.mjs.map', 'utf8'));
  for (const file of [
    'src/app.ts', 'src/app/middleware/auth.ts', 'src/app/utils/auth-session.ts',
    'src/app/middleware/login-rate-limit.ts', 'cloudflare/runtime/request-client-ip.mjs',
    'src/app/utils/password-security.ts', 'src/app/module/auth/auth.validation.ts', 'src/app/module/user/user.validation.ts',
    'src/app/module/auth/auth.service.ts', 'src/app/module/user/user.service.ts', 'cloudflare/runtime/sessions.mjs',
    'src/app/module/contentModeration/contentModeration.service.ts',
    'src/app/module/branch/branch.route.ts', 'src/app/module/availability/availability.service.ts',
  ]) {
    const i = map.sources.findIndex(source => path.resolve('cloudflare/.build', source) === path.resolve(file));
    assert.ok(i >= 0, `Missing production source: ${file}`);
    assert.equal(map.sourcesContent[i].replaceAll('\r\n', '\n'), (await readFile(file, 'utf8')).replaceAll('\r\n', '\n'), `Stale production source: ${file}`);
  }
  const bundle = await readFile('cloudflare/.build/worker.mjs', 'utf8');
  for (const marker of ['__security-test-control', '__auth-session-test', '__login-rate-test']) assert.ok(!bundle.includes(marker), 'Test control leaked into production Worker');
  assert.ok(!map.sources.some(source => /(?:security|auth-session|integration)-fixture\.mjs$/.test(source)), 'Security fixture leaked into production Worker');
});

test('Worker S8 outer error responses retain the same security headers as Express responses', async t => {
  const ctx = await setup(t);
  const missing = [];
  for (const [path, status] of [['/__internal/cron', 404], ['/__setup', 404], ['/__worker-error', 500]]) {
    const response = await ctx.fetch('https://test' + path);
    assert.equal(response.status, status);
    const body = await response.json();
    assert.equal(body.statusCode, status);
    for (const name of ['x-content-type-options', 'x-frame-options', 'referrer-policy', 'strict-transport-security', 'cross-origin-opener-policy']) {
      if (!response.headers.has(name)) missing.push({ path, status, missing: name });
    }
    assert.equal(response.headers.get('x-powered-by'), null);
  }
  assert.deepEqual(missing, [], 'Worker-created errors bypass the Express security-header middleware');
});
