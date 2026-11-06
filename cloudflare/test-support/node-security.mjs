import assert from 'node:assert/strict';
import { createServer } from 'node:http';

// No client in these suites may use local/remote application credentials.
Object.assign(process.env, {
  NODE_ENV: 'production', DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/test',
  REDIS_URL: 'redis://127.0.0.1:1', CORS_ORIGIN: 'https://frontend.example.com',
  JWT_ACCESS_SECRET: 'test-access-secret-'.repeat(3), JWT_REFRESH_SECRET: 'test-refresh-secret-'.repeat(3),
  STRIPE_SECRET_KEY: 'sk_test_fixture', STRIPE_WEBHOOK_SECRET: 'whsec_security_fixture',
  R2_ACCOUNT_ID: 'test-account', R2_ACCESS_KEY_ID: 'test-key', R2_SECRET_ACCESS_KEY: 'test-secret',
  R2_BUCKET_NAME: 'test-bucket', OPENAI_API_KEY: 'synthetic-moderation-key',
  TENCENT_SECRET_ID: 'synthetic-tencent-id', TENCENT_SECRET_KEY: 'synthetic-tencent-key',
  TENCENT_REGION: 'ap-guangzhou', TENCENT_MODERATION_BIZ_TYPE: 'text_common', TENCENT_IMS_BIZ_TYPE: 'image_common',
  EMAIL_ENCRYPTION_KEY: 'ab'.repeat(32), MICROSOFT_EMAIL_CLIENT_ID: 'test-client',
  MICROSOFT_EMAIL_CLIENT_SECRET: 'synthetic-client-secret', MICROSOFT_EMAIL_TENANT: 'organizations',
  MICROSOFT_EMAIL_REDIRECT_URI: 'https://api.example.com/api/v1/brand-email-settings/microsoft/callback',
});

export function captureLogs(t) {
  const logs = [];
  for (const method of ['log', 'info', 'warn', 'error', 'debug']) {
    t.mock.method(console, method, (...args) => { logs.push({ method, args }); });
  }
  return logs;
}

export function assertRedacted(value, markers) {
  const serialized = JSON.stringify(value);
  for (const marker of markers) {
    assert.ok(!serialized.includes(marker), 'A synthetic secret was exposed (value suppressed)');
  }
}

export function stubDelegate(t, prisma, model, method, implementation) {
  const delegate = prisma[model];
  const original = delegate[method];
  const replacement = t.mock.fn(implementation);
  delegate[method] = replacement;
  t.after(() => { delegate[method] = original; });
  return replacement;
}

export async function serve(t, app) {
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    server.closeAllConnections();
    return new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}`;
}
