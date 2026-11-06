import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const require = createRequire(path.resolve('node_modules/wrangler/package.json'));
const { Miniflare, Log, LogLevel } = await import(pathToFileURL(require.resolve('miniflare')).href);

test('exact normal production artifact boots, initializes disposable v36 storage and retains HTTP/security contracts', async t => {
  const config = JSON.parse(await readFile('wrangler.jsonc', 'utf8'));
  const bytes = await readFile(config.main);
  const digest = createHash('sha256').update(bytes).digest('hex');
  const map = JSON.parse(await readFile(config.main + '.map', 'utf8'));
  assert.ok(map.sources.some(source => source.endsWith('src/app/lib/tencent-moderation.ts')));
  assert.ok(!map.sources.some(source => /tencentcloud-sdk-nodejs|international-provider-stub|runtime\/[^/]*fixture\.mjs|test-support\//.test(source)));
  for (let i = 0; i < map.sources.length; i++) {
    const file = path.resolve('cloudflare/.build', map.sources[i]);
    if (file.startsWith(path.resolve('src') + path.sep) || file.startsWith(path.resolve('cloudflare/runtime') + path.sep)) {
      assert.equal(map.sourcesContent[i].replaceAll('\r\n', '\n'), (await readFile(file, 'utf8')).replaceAll('\r\n', '\n'), `Stale production source: ${map.sources[i]}`);
    }
  }
  assert.ok(!bytes.includes('INTERNATIONAL_TEST_TENCENT_STUB'));
  assert.ok(!bytes.includes("from 'node:readline'"));
  let externalCalls = 0;
  const bootstrap = 'synthetic-bootstrap-token-'.repeat(3);
  const mf = new Miniflare({ log: new Log(LogLevel.NONE), modules: true, scriptPath: config.main,
    compatibilityDate: config.compatibility_date, compatibilityFlags: config.compatibility_flags,
    modulesRules: [{ type: 'CompiledWasm', include: ['**/*.wasm'] }],
    durableObjects: { SALON_DB: { className: 'SalonDatabase', useSQLite: true } },
    outboundService: async () => { externalCalls++; throw new Error('External I/O forbidden in production boot test'); },
    bindings: { NODE_ENV: 'production', CORS_ORIGIN: 'https://frontend.example.com', BCRYPT_SALT_ROUNDS: '10',
      JWT_ACCESS_SECRET: 'test-access-secret-'.repeat(3), JWT_REFRESH_SECRET: 'test-refresh-secret-'.repeat(3),
      STRIPE_SECRET_KEY: 'sk_test_fixture', STRIPE_WEBHOOK_SECRET: 'whsec_test',
      R2_ACCOUNT_ID: 'test-account', R2_ACCESS_KEY_ID: 'test-key', R2_SECRET_ACCESS_KEY: 'test-secret', R2_BUCKET_NAME: 'test',
      EMAIL_ENCRYPTION_KEY: 'ab'.repeat(32),
      EMAIL_OUTBOX_ENABLED: 'false', BOOTSTRAP_TOKEN: bootstrap, BRAND_OWNER_NAME: 'Synthetic owner',
      BRAND_OWNER_EMAIL: 'production-boot@example.com', BRAND_OWNER_PASSWORD: 'OwnerPassword123!' },
  });
  t.after(() => mf.dispose());
  for (const path of ['/__internal/cron', '/__setup', '/__security-test-control', '/__auth-session-test']) {
    const response = await mf.dispatchFetch('https://test' + path);
    assert.equal(response.status, 404);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('x-powered-by'), null);
    await response.text();
  }
  const seeded = await mf.dispatchFetch('https://test/__setup', { method: 'POST', headers: { authorization: 'Bearer ' + bootstrap } });
  assert.equal(seeded.status, 200, 'Disposable production setup must succeed'); await seeded.text();
  const brand = await mf.dispatchFetch('https://test/api/v1/brand', { headers: { origin: 'https://frontend.example.com' } });
  assert.equal(brand.status, 200);
  const result = await brand.json();
  assert.equal(result.success, true); assert.equal(result.data.currency, 'HKD'); assert.equal(result.data.timezone, 'Asia/Hong_Kong');
  assert.equal(brand.headers.get('access-control-allow-origin'), 'https://frontend.example.com');
  assert.equal(brand.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.equal(brand.headers.get('strict-transport-security'), 'max-age=31536000; includeSubDomains');
  assert.equal(externalCalls, 0);
  assert.equal(createHash('sha256').update(await readFile(config.main)).digest('hex'), digest, 'Test must not replace the production artifact');
});
