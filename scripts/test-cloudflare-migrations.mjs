import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import assert from 'node:assert/strict';
await build({ entryPoints: ['cloudflare/runtime/migration-fixture.mjs'], outfile: 'node_modules/.cloudflare-test/migrations.mjs', bundle: true, format: 'esm', platform: 'neutral' });
const mf = new Miniflare({ modules: true, scriptPath: 'node_modules/.cloudflare-test/migrations.mjs', compatibilityDate: '2025-07-18', durableObjects: { DB: { className: 'MigrationFixture', useSQLite: true } } });
try {
  const response = await mf.dispatchFetch('https://test/');
  assert.equal(response.status, 200, await response.clone().text());
  assert.deepEqual(await response.json(), { preserved: true, repeatable: true, foreignKey: true, checksumProtected: true, currencyRequired: true });
  for (const scenario of ['empty','no-brand','single','multiple']) {
    const check = await mf.dispatchFetch(`https://test/branch-brand/${scenario}`);
    assert.equal(check.status,200,await check.clone().text());
    assert.deepEqual(await check.json(),{scenario,passed:true});
  }
  console.log('Existing databases upgrade to v45: nullable subscription branch limit preserves populated rows, atomic ALTER rollback and repeat startup; v44 subscription money, uniqueness and foreign keys; v43 owner and prior Branch backfill/history checks all pass.');
} finally { await mf.dispose(); }
