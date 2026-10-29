import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { createHmac } from 'node:crypto';
const require = createRequire(path.resolve('node_modules/wrangler/package.json'));
const { Miniflare, Log, LogLevel } = await import(pathToFileURL(require.resolve('miniflare')).href);
export async function setup(t, flag, emailOutboxEnabled = 'false') {
  const mf = new Miniflare({ log: new Log(LogLevel.NONE), modules: true, scriptPath: 'cloudflare/.build/integration.mjs', compatibilityDate: '2025-10-11', compatibilityFlags: ['nodejs_compat', 'enable_nodejs_http_server_modules'], modulesRules: [{ type: 'CompiledWasm', include: ['**/*.wasm'] }], durableObjects: { SALON_DB: { className: 'SalonTestDatabase', useSQLite: true } }, bindings: {
    NODE_ENV: 'production', CORS_ORIGIN: 'https://frontend.example.com', BCRYPT_SALT_ROUNDS: '10', JWT_ACCESS_SECRET: 'test-access-secret-'.repeat(3), JWT_REFRESH_SECRET: 'test-refresh-secret-'.repeat(3), STRIPE_SECRET_KEY: 'sk_test_fixture', STRIPE_WEBHOOK_SECRET: 'whsec_test', OPENAI_API_KEY: 'test-key', R2_ACCOUNT_ID: 'test-account', R2_ACCESS_KEY_ID: 'test-key', R2_SECRET_ACCESS_KEY: 'test-secret', R2_BUCKET_NAME: 'test', EMAIL_SENDER: 'test@example.com', BOOTSTRAP_TOKEN: 'test-bootstrap-token-'.repeat(3), BRAND_OWNER_NAME: 'Owner', BRAND_OWNER_EMAIL: 'owner@example.com', BRAND_OWNER_PASSWORD: 'OwnerPassword123!', ...(flag !== undefined && { ENABLE_BOOK_NOW_PURCHASE: flag }),
    EMAIL_OUTBOX_ENABLED: emailOutboxEnabled, EMAIL_ENCRYPTION_KEY: 'ab'.repeat(32), MICROSOFT_EMAIL_CLIENT_ID: 'test-client', MICROSOFT_EMAIL_CLIENT_SECRET: 'test-secret',
    MICROSOFT_EMAIL_REDIRECT_URI: 'https://test/api/v1/brand-email-settings/microsoft/callback',
  } });
  t.after(() => mf.dispose());
  let token;
  const api = async (url, { body, method = body ? 'POST' : 'GET', status = 200, roleToken = token } = {}) => {
    const response = await mf.dispatchFetch(`https://test${url}`, { method, headers: { ...(body && { 'content-type': 'application/json' }), ...(roleToken && { authorization: `Bearer ${roleToken}` }) }, ...(body && { body: JSON.stringify(body) }) });
    const text = await response.text(); assert.equal(response.status, status, `${method} ${url}: ${text}`);
    return text ? JSON.parse(text) : null;
  };
  const bootstrap = await mf.dispatchFetch('https://test/__setup', { method: 'POST', headers: { authorization: `Bearer ${'test-bootstrap-token-'.repeat(3)}` } });
  assert.equal(bootstrap.status, 200, await bootstrap.text());
  const credentials = { email: 'book-now-customer@example.com', password: 'StrongPassword123!' };
  const registered = await api('/api/v1/auth/register', { body: { ...credentials, name: 'Book Now Customer' }, status: 201 });
  token = (await api('/api/v1/auth/login', { body: credentials })).data.accessToken;
  const ownerToken = (await api('/api/v1/auth/login', { body: { email: 'owner@example.com', password: 'OwnerPassword123!' } })).data.accessToken;
  const fixture = await api('/__book-now-fixture', { body: { customerId: registered.data.id } });
  const managerToken = (await api('/api/v1/auth/login', { body: { email: 'book-now-manager@example.com', password: credentials.password } })).data.accessToken;
  const otherManagerToken = (await api('/api/v1/auth/login', { body: { email: 'book-now-other-manager@example.com', password: credentials.password } })).data.accessToken;
  const state = () => api('/__book-now-state');
  const webhook = async event => {
    const body = JSON.stringify(event); const time = Math.floor(Date.now() / 1000);
    const signature = createHmac('sha256', 'whsec_test').update(`${time}.${body}`).digest('hex');
    const response = await mf.dispatchFetch('https://test/api/v1/payments/stripe/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': `t=${time},v1=${signature}` }, body });
    assert.equal(response.status, 200, await response.text());
  };
  const cron = async () => { const namespace = await mf.getDurableObjectNamespace('SALON_DB'); const response = await namespace.get(namespace.idFromName('salon-v1')).fetch('https://internal/__internal/cron'); assert.equal(response.status, 200, await response.text()); };
  const scheduled = async () => { const worker = await mf.getWorker(); const event = await worker.scheduled({ cron: '* * * * *' }); assert.equal(event.outcome, 'ok'); };
  return { api, ownerToken, managerToken, otherManagerToken, fixture, state, webhook, cron, scheduled };
}

