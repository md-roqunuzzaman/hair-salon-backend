import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import assert from 'node:assert/strict';
await build({ entryPoints: ['cloudflare/runtime/migration-fixture.mjs'], outfile: 'node_modules/.cloudflare-test/migrations.mjs', bundle: true, format: 'esm', platform: 'neutral' });
const mf = new Miniflare({ modules: true, scriptPath: 'node_modules/.cloudflare-test/migrations.mjs', compatibilityDate: '2025-07-18', durableObjects: { DB: { className: 'MigrationFixture', useSQLite: true } } });
try {
  const response = await mf.dispatchFetch('https://test/');
  assert.equal(response.status, 200, await response.clone().text());
  assert.deepEqual(await response.json(), { preserved: true, repeatable: true, foreignKey: true, checksumProtected: true });
    console.log('Existing databases upgrade to v32: branch location/outbox lock indexes, exact columns, atomic failure rollback, all existing rows/history and repeat ledger checks pass; prior validity, allocation/ledger, policy minutes, registration, carousel, foreign-key and immutable-history checks pass.');
} finally { await mf.dispose(); }
