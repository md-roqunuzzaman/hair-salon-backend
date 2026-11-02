import { assertRedacted, captureLogs, serve, stubDelegate } from './test-support/node-security.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { Moderations } from 'openai/resources/moderations';

const { contentModerationService } = await import('../src/app/module/contentModeration/contentModeration.service.ts');
const { reviewService } = await import('../src/app/module/review/review.service.ts');
const { prisma } = await import('../src/app/lib/prisma.ts');
const { redisClient } = await import('../src/app/lib/redis.ts');
const { jwtUtils } = await import('../src/app/utils/jwt.ts');
const { notificationService } = await import('../src/app/module/notification/notification.service.ts');
const { uploadService } = await import('../src/app/module/upload/upload.service.ts');
const { default: app } = await import('../src/app.ts');
const safeResult = { flagged: false, categories: { harassment: false, violence: false } };
const flaggedResult = { flagged: true, categories: { harassment: true, violence: false } };
const valid = result => ({ results: [result] });
const now = new Date('2026-11-02T04:00:00.000Z');

function fixture(t, response, failure) {
  if (arguments.length < 2) response = valid(safeResult);
  const logs = captureLogs(t);
  // Mock the real SDK resource, not the application's moderation service.
  const provider = t.mock.method(Moderations.prototype, 'create', async () => {
    if (failure) throw failure;
    return response;
  });
  let row = { id: 'review', customerId: 'customer', branchId: 'branch', staffId: 'staff',
    appointmentId: 'appointment', rating: 5, comment: 'Original text', images: [],
    moderationStatus: 'VISIBLE', moderationReason: null, replyText: null, createdAt: now, updatedAt: now };
  const writes = [];
  stubDelegate(t, prisma, 'appointment', 'findUnique', async () => ({ id: 'appointment', customerId: 'customer', branchId: 'branch', staffId: 'staff', appointmentStatus: 'COMPLETED' }));
  const findReview = stubDelegate(t, prisma, 'review', 'findUnique', async () => row);
  stubDelegate(t, prisma, 'branchManagerBranch', 'findUnique', async () => ({ userId: 'manager', branchId: 'branch' }));
  const persist = async ({ data }) => {
    writes.push(data);
    row = { ...row, ...data, images: data.images ? data.images.create : row.images,
      repliedBy: data.repliedById ? { id: data.repliedById, name: 'Owner', role: 'BRAND_OWNER' } : null };
    return row;
  };
  stubDelegate(t, prisma, 'review', 'create', persist);
  const update = stubDelegate(t, prisma, 'review', 'update', persist);
  const deleteImages = t.mock.fn(async () => ({ count: row.images.length }));
  const originalTransaction = prisma.$transaction;
  prisma.$transaction = async callback => callback({ review: { update }, reviewImage: { deleteMany: deleteImages } });
  t.after(() => { prisma.$transaction = originalTransaction; });
  const notifications = t.mock.method(notificationService, 'createNotification', async () => ({ id: 'notification' }));
  t.mock.method(uploadService, 'verifyImageExists', async () => {});
  t.mock.method(uploadService, 'getImageUrl', async objectKey => `https://images.example.com/${objectKey}?synthetic-signature=redacted`);
  return { logs, provider, writes, notifications, findReview, deleteImages, row: () => row,
    create: payload => {
      findReview.mock.mockImplementation(async () => null);
      return reviewService.createReview('customer', 'appointment', payload);
    },
  };
}

for (const [label, response, status, reason] of [
  ['safe', valid(safeResult), 'VISIBLE', null],
  ['flagged', valid(flaggedResult), 'HIDDEN', 'harassment'],
]) {
  test(`S6 valid ${label} responses preserve text, image and review classification`, async t => {
    fixture(t, response);
    for (const result of [await contentModerationService.moderateText('Review text'),
      await contentModerationService.moderateImage('https://images.example.com/review.jpg'),
      await contentModerationService.moderateReviewContent('Review text', ['https://images.example.com/review.jpg'])]) {
      assert.equal(result.safe, status === 'VISIBLE');
      assert.equal(result.flagged, status === 'HIDDEN');
      assert.equal(result.reason, reason);
    }
  });
}

const malformed = [
  ['null envelope', null], ['undefined envelope', undefined], ['array envelope', []],
  ['missing results', {}], ['null results', { results: null }], ['empty results', { results: [] }],
  ['object results', { results: { 0: safeResult } }],
  ['null result', valid(null)], ['undefined result', valid(undefined)], ['array result', valid([])],
  ['missing flagged', valid({ categories: { harassment: false } })],
  ['string flagged', valid({ flagged: 'false', categories: { harassment: false } })],
  ['numeric flagged', valid({ flagged: 0, categories: { harassment: false } })],
  ['missing categories', valid({ flagged: false })], ['null categories', valid({ flagged: false, categories: null })],
  ['array categories', valid({ flagged: false, categories: [] })], ['string categories', valid({ flagged: false, categories: 'safe' })],
  ['empty categories', valid({ flagged: false, categories: {} })],
  ['string category value', valid({ flagged: false, categories: { harassment: 'false' } })],
  ['numeric category value', valid({ flagged: false, categories: { harassment: 0 } })],
  ['null category value', valid({ flagged: false, categories: { harassment: null } })],
  ['undefined category value', valid({ flagged: false, categories: { harassment: undefined } })],
  ['contradictory flags', valid({ flagged: false, categories: { harassment: true } })],
  ['later malformed result', { results: [safeResult, { flagged: false }] }],
];

for (const [label, response] of malformed) {
  test(`S6 malformed moderation fails closed across every entry point: ${label}`, async t => {
    fixture(t, response);
    for (const run of [() => contentModerationService.moderateText('Review text'),
      () => contentModerationService.moderateImage('https://images.example.com/review.jpg'),
      () => contentModerationService.moderateReviewContent('Review text', [])]) {
      let rejected = false;
      try { await run(); } catch { rejected = true; }
      assert.equal(rejected, true, 'Invalid provider response must never be accepted as safe');
    }
  });
}

test('S6 later flagged results cannot be ignored; rating-only reviews retain the existing bypass', async t => {
  const f = fixture(t, { results: [safeResult, flaggedResult] });
  const result = await contentModerationService.moderateReviewContent('Mixed input', ['https://images.example.com/review.jpg']);
  assert.equal(result.safe, false);
  assert.equal(result.flagged, true);
  assert.deepEqual(result.categories, ['harassment']);
  f.provider.mock.resetCalls();
  assert.equal((await contentModerationService.moderateText('  ')).safe, true);
  assert.equal((await contentModerationService.moderateReviewContent(null, [])).safe, true);
  assert.equal(f.provider.mock.callCount(), 0);
});

test('S6 network errors propagate to callers without being mistaken for a safe result', async t => {
  const marker = randomUUID();
  fixture(t, undefined, new Error(marker));
  for (const run of [() => contentModerationService.moderateText('Review text'),
    () => contentModerationService.moderateImage('https://images.example.com/review.jpg'),
    () => contentModerationService.moderateReviewContent('Review text', [])]) {
    await assert.rejects(run);
  }
});

for (const [label, response, status, failure] of [
  ['safe', valid(safeResult), 'VISIBLE'], ['flagged', valid(flaggedResult), 'HIDDEN'],
  ['malformed', { results: { 0: safeResult } }, 'PENDING'],
  ['network failure', undefined, 'PENDING', new Error('synthetic-provider-detail')],
]) {
  for (const operation of ['create', 'update']) {
    test(`S6 ${operation} persistence uses ${status} for ${label} moderation`, async t => {
      const f = fixture(t, response, failure);
      const payload = { rating: 4, comment: 'Customer text', imageObjectKeys: ['reviews/customer/photo.jpg'] };
      const result = operation === 'create' ? await f.create(payload) : await reviewService.updateReview('customer', 'review', payload);
      assert.equal(result.moderationStatus, status);
      assert.equal(f.writes.length, 1);
      assert.equal(f.writes[0].moderationStatus, status);
      assert.equal(f.row().comment, payload.comment);
      assert.deepEqual(f.row().images, [{ objectKey: 'reviews/customer/photo.jpg', sortOrder: 0 }]);
      assert.equal(result.moderationReason, status === 'PENDING' ? 'Moderation service unavailable' : status === 'HIDDEN' ? 'harassment' : null);
      assert.equal(f.notifications.mock.calls[0].arguments[0].type, status === 'PENDING' ? 'REVIEW_PENDING' : status === 'HIDDEN' ? 'REVIEW_NEEDS_CHANGES' : 'REVIEW_PUBLISHED');
      assertRedacted([result, f.logs], ['synthetic-provider-detail']);
    });
  }
}

test('S6 rating-only update preserves existing moderation status and authorization guards', async t => {
  const f = fixture(t, undefined, new Error('must not call provider'));
  await reviewService.updateReview('customer', 'review', { rating: 3 });
  assert.equal(f.provider.mock.callCount(), 0);
  assert.equal(f.writes[0].moderationStatus, undefined);
  await assert.rejects(reviewService.updateReview('other-customer', 'review', { comment: 'Denied' }), { statusCode: 403 });
  await assert.rejects(reviewService.saveReviewReply('review', 'customer', 'CUSTOMER', { reply: 'Denied' }), { statusCode: 403 });
});

for (const role of ['BRAND_OWNER', 'BRANCH_MANAGER']) {
  for (const kind of ['malformed', 'network']) {
    test(`S6 ${role} ${kind} moderation returns safe HTTP 503 without persisting a reply`, async t => {
      const marker = randomUUID();
      const f = fixture(t, { results: { 0: safeResult } }, kind === 'network' ? new Error(marker) : undefined);
      stubDelegate(t, prisma, 'user', 'findUnique', async () => ({ id: 'actor', email: 'actor@example.com', name: 'Actor', role, status: 'ACTIVE', emailVerified: true, mustChangePassword: false }));
      t.mock.method(redisClient, 'get', async key => key === 'auth:refresh:actor:security-test' ? 'valid' : null);
      const token = jwtUtils.createToken({ userId: 'actor', sid: 'security-test' }, process.env.JWT_ACCESS_SECRET, '5m');
      const base = await serve(t, app);
      const response = await fetch(`${base}/api/v1/reviews/review/reply`, { method: 'PUT',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ reply: 'Merchant reply' }) });
      const result = await response.json();
      assert.equal(response.status, 503);
      assert.equal(result.success, false);
      assert.equal(result.statusCode, 503);
      assert.equal(result.message, 'REVIEW_REPLY_MODERATION_UNAVAILABLE');
      assert.equal(f.writes.length, 0);
      assert.equal(f.row().replyText, null);
      assert.equal(f.notifications.mock.callCount(), 0);
      assertRedacted([result, f.logs], [marker, token]);
    });
  }
  test(`S6 ${role} safe reply is saved; flagged reply is rejected without a write`, async t => {
    const f = fixture(t);
    const result = await reviewService.saveReviewReply('review', 'actor', role, { reply: ' Safe reply ' });
    assert.equal(result.reply.text, 'Safe reply');
    assert.equal(f.writes.length, 1);
    assert.equal(f.notifications.mock.calls[0].arguments[0].type, 'REVIEW_REPLY');
    f.provider.mock.mockImplementation(async () => valid(flaggedResult));
    await assert.rejects(reviewService.saveReviewReply('review', 'actor', role, { reply: 'Rejected reply' }), { statusCode: 422, message: 'REVIEW_REPLY_CONTENT_NOT_ALLOWED' });
    assert.equal(f.writes.length, 1);
    assert.equal(f.row().replyText, 'Safe reply');
    f.provider.mock.mockImplementation(async () => { throw new Error('synthetic-provider-detail'); });
    await assert.rejects(reviewService.saveReviewReply('review', 'actor', role, { reply: 'Unmoderated edit' }), { statusCode: 503, message: 'REVIEW_REPLY_MODERATION_UNAVAILABLE' });
    assert.equal(f.writes.length, 1);
    assert.equal(f.row().replyText, 'Safe reply');
  });
}
