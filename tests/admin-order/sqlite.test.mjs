import test from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare, Log, LogLevel } from 'miniflare';

test('Admin orders execute in workerd using production SQLite facade and real HTTP router', async t => {
  const mf = new Miniflare({ log: new Log(LogLevel.NONE), modules: true, scriptPath: 'cloudflare/.build/admin-order-tests.mjs',
    compatibilityDate: '2025-10-11', compatibilityFlags: ['nodejs_compat', 'enable_nodejs_http_server_modules'],
    modulesRules: [{ type: 'CompiledWasm', include: ['**/*.wasm'] }],
    durableObjects: { SALON_DB: { className: 'SalonTestDatabase', useSQLite: true } }, bindings: {
      NODE_ENV: 'production', CORS_ORIGIN: 'https://frontend.example.com', BCRYPT_SALT_ROUNDS: '10',
      JWT_ACCESS_SECRET: 'synthetic-access-'.repeat(4), JWT_REFRESH_SECRET: 'synthetic-refresh-'.repeat(4),
      STRIPE_SECRET_KEY: 'sk_test_synthetic', STRIPE_WEBHOOK_SECRET: 'whsec_synthetic', OPENAI_API_KEY: 'synthetic',
      R2_ACCOUNT_ID: 'synthetic', R2_ACCESS_KEY_ID: 'synthetic', R2_SECRET_ACCESS_KEY: 'synthetic', R2_BUCKET_NAME: 'synthetic',
      EMAIL_SENDER: 'test@admin-order.invalid', BOOTSTRAP_TOKEN: 'synthetic-bootstrap-'.repeat(4),
      BRAND_OWNER_NAME: 'Unused', BRAND_OWNER_EMAIL: 'unused@admin-order.invalid', BRAND_OWNER_PASSWORD: 'SyntheticUnused123!',
      EMAIL_OUTBOX_ENABLED: 'false', EMAIL_ENCRYPTION_KEY: 'ab'.repeat(32), TENCENT_SECRET_ID: 'synthetic', TENCENT_SECRET_KEY: 'synthetic',
    } });
  t.after(() => mf.dispose());
  const response = await mf.dispatchFetch('https://test/__admin-order-tests');
  const body = await response.json(); assert.equal(response.status, 200, JSON.stringify(body));
  for (const r of body.results) await t.test(r.name, () => assert.equal(r.pass, true, r.error));
  const api = async (url, status, token, data) => {
    const res = await mf.dispatchFetch('https://test' + url, { method: data ? 'POST' : 'GET', headers: {
      'cf-connecting-ip': '192.0.2.10', ...(token ? { authorization: 'Bearer ' + token } : {}), ...(data ? { 'content-type': 'application/json' } : {}),
    }, ...(data ? { body: JSON.stringify(data) } : {}) });
    const result = await res.json(); assert.equal(res.status, status, JSON.stringify(result)); return result;
  };
  await t.test('HTTP authentication, list/detail registration and validation', async () => {
    await api('/api/v1/admin/orders', 401);
    const login = await api('/api/v1/auth/login', 200, null, { email: 'owner@admin-order.invalid', password: 'SyntheticAdminOrders123!' });
    const token = login.data.accessToken;
    const list = await api('/api/v1/admin/orders?limit=2', 200, token);
    assert.equal(list.data.pagination.total, 13); assert.equal(list.data.items.length, 2);
    await api('/api/v1/admin/orders?limit=101', 400, token);
    await api('/api/v1/admin/orders/APPOINTMENT/' + body.fixture.appointments[0].id, 200, token);
    await api('/api/v1/admin/orders/APPOINTMENT/' + body.fixture.foreign.id, 404, token);
    await api('/api/v1/admin/orders/GROUP_PURCHASE/' + body.fixture.branchless.id, 200, token);
    const customer = await api('/api/v1/auth/login', 200, null, { email: 'customer@admin-order.invalid', password: 'SyntheticAdminOrders123!' });
    await api('/api/v1/admin/orders', 403, customer.data.accessToken);
    const manager = await api('/api/v1/auth/login', 200, null, { email: 'manager@admin-order.invalid', password: 'SyntheticAdminOrders123!' });
    await api('/api/v1/admin/orders/GROUP_PURCHASE/' + body.fixture.branchless.id, 404, manager.data.accessToken);
  });
});
