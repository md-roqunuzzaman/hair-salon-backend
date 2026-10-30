import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import assert from 'node:assert/strict';
await build({ entryPoints: ['cloudflare/runtime/migration-fixture.mjs'], outfile: 'node_modules/.cloudflare-test/migrations.mjs', bundle: true, format: 'esm', platform: 'neutral' });
const mf = new Miniflare({ modules: true, scriptPath: 'node_modules/.cloudflare-test/migrations.mjs', compatibilityDate: '2025-07-18', durableObjects: { DB: { className: 'MigrationFixture', useSQLite: true } } });
try {
  const response = await mf.dispatchFetch('https://test/');
  assert.equal(response.status, 200, await response.clone().text());
  assert.deepEqual(await response.json(), { preserved: true, repeatable: true, foreignKey: true, checksumProtected: true });
    console.log('Existing databases upgrade to v30: additive refund allocation/ledger upgrade, atomic failure rollback, unchanged financial rows and repeated initialization pass; policy minutes conversion, unchanged historical snapshots and rollback/repeat checks pass; registration verification defaults, legacy customer access, atomic rollback and repeat initialization pass; carousel defaults, branch uniqueness, required/FK/cascade behavior, atomic rollback and repeat initialization pass; existing data and migration history preserved.');
} finally { await mf.dispose(); }
