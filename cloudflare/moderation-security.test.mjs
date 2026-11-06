import { assertRedacted, captureLogs, serve, stubDelegate } from './test-support/node-security.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { safeResult, flaggedResult, reviewResult, valid } from './test-support/tencent-responses.mjs';

const { contentModerationService } = await import('../src/app/module/contentModeration/contentModeration.service.ts');
const { reviewService } = await import('../src/app/module/review/review.service.ts');
const { prisma } = await import('../src/app/lib/prisma.ts');
const { redisClient } = await import('../src/app/lib/redis.ts');
const { jwtUtils } = await import('../src/app/utils/jwt.ts');
const { notificationService } = await import('../src/app/module/notification/notification.service.ts');
const { uploadService } = await import('../src/app/module/upload/upload.service.ts');
const { default: app } = await import('../src/app.ts');
const now = new Date('2026-11-02T04:00:00.000Z');

function fixture(t, response, failure) {
  if (arguments.length < 2) response = valid(safeResult);
  const logs = captureLogs(t);
  // Mock external HTTP only; the real TC3 signer, validator and callers run.
  const provider = t.mock.fn(async () => {
    if (failure) throw failure;
    return response;
  });
  const originalFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (['tms.tencentcloudapi.com', 'ims.tencentcloudapi.com'].includes(url.hostname)) {
      const result = await provider(input, init);
      return new Response(result === undefined ? undefined : JSON.stringify(result), { headers: { 'content-type': 'application/json' } });
    }
    return originalFetch(input, init);
  });
  let row = { id: 'review', customerId: 'customer', branchId: 'branch', staffId: 'staff',
    appointmentId: 'appointment', rating: 5, comment: 'Original text', images: [],
    moderationStatus: 'VISIBLE', moderationReason: null, replyText: null, createdAt: now, updatedAt: now };
  const writes = [];
  stubDelegate(t, prisma, 'appointment', 'findUnique', async () => ({ id: 'appointment', customerId: 'customer', branchId: 'branch', staffId: 'staff', appointmentStatus: 'COMPLETED' }));
  const findReview = stubDelegate(t, prisma, 'review', 'findUnique', async () => row);
  const managerScope = stubDelegate(t, prisma, 'branchManagerBranch', 'findUnique', async () => ({ userId: 'manager', branchId: 'branch' }));
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
  return { logs, provider, managerScope, writes, notifications, findReview, deleteImages, row: () => row,
    create: payload => {
      findReview.mock.mockImplementation(async () => null);
      return reviewService.createReview('customer', 'appointment', payload);
    },
  };
}

for (const [label, response, status, reason] of [
  ['safe', valid(safeResult), 'VISIBLE', null],
  ['flagged', valid(flaggedResult), 'HIDDEN', 'Abuse'],
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

// Each obsolete OpenAI shape/type assertion is replaced by an actual Tencent
// envelope/classification assertion; invalid input still must reject everywhere.
const malformed = [
  ['null envelope', null], ['undefined envelope', undefined], ['array envelope', []],
  ['missing Response', {}], ['null Response', valid(null)], ['empty Response', valid({})],
  ['object indexed as array', valid({ 0: safeResult })], ['array Response', valid([])],
  ['missing Suggestion', valid({ ...safeResult, Suggestion: undefined })],
  ['boolean Suggestion', valid({ ...safeResult, Suggestion: false })],
  ['numeric Suggestion', valid({ ...safeResult, Suggestion: 0 })],
  ['unknown Suggestion', valid({ ...safeResult, Suggestion: 'Allow' })],
  ['missing Label', valid({ ...safeResult, Label: undefined })],
  ['null Label', valid({ ...safeResult, Label: null })],
  ['array Label', valid({ ...safeResult, Label: [] })],
  ['empty Label', valid({ ...safeResult, Label: '' })],
  ['missing Score', valid({ ...safeResult, Score: undefined })],
  ['string Score', valid({ ...safeResult, Score: '0' })],
  ['null Score', valid({ ...safeResult, Score: null })],
  ['out of range Score', valid({ ...safeResult, Score: 101 })],
  ['numeric RequestId', valid({ ...safeResult, RequestId: 123 })],
  ['missing RequestId', valid({ ...safeResult, RequestId: undefined })],
  ['fractional Score', valid({ ...safeResult, Score: 0.5 })],
  ['negative Score', valid({ ...safeResult, Score: -1 })],
  ['invalid SubLabel', valid({ ...safeResult, SubLabel: [] })],
  ['invalid category value', valid({ ...safeResult, LabelResults: [{ ...safeResult, Suggestion: 'false' }] })],
  ['null category entry', valid({ ...safeResult, DetailResults: [null] })],
  ['object category list', valid({ ...safeResult, LabelResults: { 0: safeResult } })],
  ['later malformed category', valid({ ...safeResult, DetailResults: [safeResult, { ...safeResult, Score: false }] })],
  ['contradictory safe summary', valid({ ...safeResult, DetailResults: [safeResult, flaggedResult] })],
  ['object library category list', valid({ ...safeResult, LibResults: {} })],
  ['later malformed library category', valid({ ...safeResult, LibResults: [safeResult, { ...safeResult, Score: false }] })],
  ['contradictory library category', valid({ ...safeResult, LibResults: [flaggedResult] })],
  ['provider Error despite valid fields', valid({ ...safeResult, Error: { Code: 'FailedOperation', Message: 'synthetic-provider-detail' } })],
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

test('S6 later flagged inputs cannot be ignored; rating-only reviews retain the existing bypass', async t => {
  const f = fixture(t);
  let request = 0;
  f.provider.mock.mockImplementation(async () => valid(++request === 1 ? safeResult : flaggedResult));
  const result = await contentModerationService.moderateReviewContent('Mixed input', ['https://images.example.com/review.jpg']);
  assert.equal(result.safe, false);
  assert.equal(result.flagged, true);
  assert.deepEqual(result.categories, ['Abuse']);
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

test('S6 nullable/empty Tencent detail arrays retain valid summary decisions', async t => {
  fixture(t, valid({ ...safeResult, DetailResults: null, LabelResults: [], Keywords: null }));
  assert.equal((await contentModerationService.moderateText('Valid optional fields')).decision, 'PASS');
});

test('S6 image library results accept the documented nullable SubLabel without interpreting detail rows as decisions', async t => {
  fixture(t, valid({ ...safeResult, LibResults: [{ ...safeResult, SubLabel: null, Details: [{ Id: 1, Label: 'Normal', Score: 0 }] }] }));
  assert.equal((await contentModerationService.moderateImage('https://images.example.com/library.jpg')).decision, 'PASS');
});

test('S6 Suggestion remains authoritative; low-scoring scene labels do not invent a blocking threshold', async t => {
  fixture(t, valid({ ...safeResult, Label: 'Porn', Score: 0 }));
  const result = await contentModerationService.moderateImage('https://images.example.com/safe.jpg');
  assert.equal(result.decision, 'PASS'); assert.equal(result.flagged, false);
});

test('S6 every image is assessed; a later invalid response cannot be hidden by an earlier classification', async t => {
  const f = fixture(t); let count = 0;
  f.provider.mock.mockImplementation(async () => valid(++count === 3 ? { ...safeResult, Score: false } : count === 2 ? flaggedResult : safeResult));
  await assert.rejects(contentModerationService.moderateReviewContent('Text', ['https://images.example.com/one.jpg', 'https://images.example.com/two.jpg']));
  assert.equal(f.provider.mock.callCount(), 3);
});

test('S6 manager scope and review visibility are enforced before provider I/O', async t => {
  const f = fixture(t);
  f.managerScope.mock.mockImplementation(async () => null);
  await assert.rejects(reviewService.saveReviewReply('review', 'other-branch-manager', 'BRANCH_MANAGER', { reply: 'Denied' }), { statusCode: 403, message: 'FORBIDDEN_BRANCH_SCOPE' });
  f.row().moderationStatus = 'PENDING';
  await assert.rejects(reviewService.saveReviewReply('review', 'owner', 'BRAND_OWNER', { reply: 'Denied' }), { statusCode: 409, message: 'REVIEW_REPLY_NOT_ALLOWED' });
  assert.equal(f.provider.mock.callCount(), 0); assert.equal(f.writes.length, 0);
});

for (const [label, response, status, failure] of [
  ['safe', valid(safeResult), 'VISIBLE'], ['flagged', valid(flaggedResult), 'HIDDEN'],
  ['review', valid(reviewResult), 'PENDING'],
  ['malformed', valid({ ...safeResult, Suggestion: false }), 'PENDING'],
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
      assert.equal(result.moderationReason, label === 'review' ? 'Abuse' : status === 'PENDING' ? 'Moderation service unavailable' : status === 'HIDDEN' ? 'Abuse' : null);
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
      const f = fixture(t, valid({ ...safeResult, Suggestion: false }), kind === 'network' ? new Error(marker) : undefined);
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
    f.provider.mock.mockImplementation(async () => valid(reviewResult));
    await assert.rejects(reviewService.saveReviewReply('review', 'actor', role, { reply: 'Requires review' }), { statusCode: 422, message: 'REVIEW_REPLY_CONTENT_NOT_ALLOWED' });
    assert.equal(f.writes.length, 1);
    f.provider.mock.mockImplementation(async () => { throw new Error('synthetic-provider-detail'); });
    await assert.rejects(reviewService.saveReviewReply('review', 'actor', role, { reply: 'Unmoderated edit' }), { statusCode: 503, message: 'REVIEW_REPLY_MODERATION_UNAVAILABLE' });
    assert.equal(f.writes.length, 1);
    assert.equal(f.row().replyText, 'Safe reply');
  });
}
