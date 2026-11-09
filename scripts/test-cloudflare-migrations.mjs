import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import assert from 'node:assert/strict';
await build({ entryPoints: ['cloudflare/runtime/migration-fixture.mjs'], outfile: 'node_modules/.cloudflare-test/migrations.mjs', bundle: true, format: 'esm', platform: 'neutral' });
const mf = new Miniflare({ modules: true, scriptPath: 'node_modules/.cloudflare-test/migrations.mjs', compatibilityDate: '2025-07-18', durableObjects: { DB: { className: 'MigrationFixture', useSQLite: true } } });
try {
  const response = await mf.dispatchFetch('https://test/');
  assert.equal(response.status, 200, await response.clone().text());
  assert.deepEqual(await response.json(), { preserved: true, repeatable: true, foreignKey: true, checksumProtected: true, currencyRequired: true });
  console.log('Existing databases upgrade to v37: unreconciled currency rejection, atomic trigger/ledger rollback, unchanged financial rows and referenced table, required currency enforcement, retained HKD/GBP/JPY, money/FK guards and repeated startup pass; every prior migration check remains included.');
} finally { await mf.dispose(); }
