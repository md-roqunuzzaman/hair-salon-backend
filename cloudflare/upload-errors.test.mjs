import assert from 'node:assert/strict';
import test from 'node:test';
Object.assign(process.env, {
  NODE_ENV: 'production', DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/test',
  REDIS_URL: 'redis://127.0.0.1:1', JWT_ACCESS_SECRET: 'test-access-secret-'.repeat(3),
  JWT_REFRESH_SECRET: 'test-refresh-secret-'.repeat(3), STRIPE_SECRET_KEY: 'sk_test_fixture',
  R2_ACCOUNT_ID: 'test-account', R2_ACCESS_KEY_ID: 'test-key', R2_SECRET_ACCESS_KEY: 'test-secret',
  R2_BUCKET_NAME: 'test-bucket', OPENAI_API_KEY: 'test-key',
});
const { r2Client } = await import('../src/app/lib/r2.ts');
const { uploadService } = await import('../src/app/module/upload/upload.service.ts');
const id = '11111111-1111-4111-8111-111111111111';
const payload = { objectKey: `users/${id}/avatar.png`, purpose: 'USER_AVATAR', entityId: id };
const requester = { userId: id, role: 'CUSTOMER' };
for (const [name, response, error, status, message] of [
  ['missing object', null, Object.assign(new Error('private S3 details'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } }), 404, 'UPLOADED_IMAGE_NOT_FOUND'],
  ['storage outage', null, new Error('private S3 secret connection info'), 502, 'Image storage is temporarily unavailable. Please try again later'],
  ['storage credentials', null, Object.assign(new Error('private key'), { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } }), 502, 'Image storage is temporarily unavailable. Please try again later'],
  ['unsupported image', { ContentType: 'text/plain', ContentLength: 10 }, null, 400, 'INVALID_IMAGE_TYPE'],
  ['empty image', { ContentType: 'image/png', ContentLength: 0 }, null, 400, 'INVALID_IMAGE_SIZE'],
  ['large image', { ContentType: 'image/png', ContentLength: 6 * 1024 * 1024 }, null, 400, 'IMAGE_TOO_LARGE'],
]) test(`real upload service: ${name}`, async t => {
  t.mock.method(console, 'error', () => {});
  t.mock.method(r2Client, 'send', async () => { if (error) throw error; return response; });
  await assert.rejects(uploadService.confirmImageUpload(payload, requester), rejected => rejected.statusCode === status && rejected.message === message);
});
