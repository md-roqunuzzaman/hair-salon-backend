import { spawnSync } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
await mkdir('node_modules/.cloudflare-test', { recursive: true });
const output = 'node_modules/.cloudflare-test/expected-schema.sql';
const result = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'diff',
  '--from-empty', '--to-schema', 'cloudflare/prisma/schema.prisma', '--script', '--output', output,
  '--config', 'cloudflare/prisma.config.ts'], { stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

const { Miniflare } = await import('miniflare');
const { default: assert } = await import('node:assert/strict');
const mf = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("schema check"); } };', compatibilityDate: '2025-07-18', d1Databases: { EXPECTED: 'expected', ACTUAL: 'actual' } });
try {
  const expected = await mf.getD1Database('EXPECTED');
  const actual = await mf.getD1Database('ACTUAL');
  const apply = async (db, sql) => {
    for (const statement of sql.replace(/^--.*$/gm, '').split(';').filter(value => value.trim())) await db.prepare(statement).run();
  };
  await apply(expected, await readFile(output, 'utf8'));
  await apply(actual, await readFile('cloudflare/migrations/0001_initial.sql', 'utf8'));
  await apply(actual, await readFile('cloudflare/migrations/0002_wallet_topup_promotion.sql', 'utf8'));
  await apply(actual, await readFile('cloudflare/migrations/0003_branch_qr_verification_rule.sql', 'utf8'));
  await apply(actual, await readFile('cloudflare/migrations/0004_unified_group_purchase.sql', 'utf8'));
  await apply(actual, await readFile('cloudflare/migrations/0005_refund_attempt_fence.sql', 'utf8'));
  await apply(actual, await readFile('cloudflare/migrations/0006_group_settlement_identity.sql', 'utf8'));
  await apply(actual, await readFile('cloudflare/migrations/0007_branch_coordinates.sql', 'utf8'));
  await apply(actual, await readFile('cloudflare/migrations/0008_rename_direct_book.sql', 'utf8'));
  await apply(actual, await readFile('cloudflare/migrations/0009_policy_schema.sql', 'utf8'));
  // Trigger bodies contain semicolons; the structural fingerprint excludes triggers.
  await apply(actual, (await readFile('cloudflare/migrations/0010_refund_request_entitlements.sql', 'utf8')).split('CREATE TRIGGER')[0]);
  await apply(actual, await readFile('cloudflare/migrations/0011_branch_group_purchase_policies.sql', 'utf8'));
  await apply(actual, await readFile('cloudflare/migrations/0012_merchant_policy_execution.sql', 'utf8'));
  await apply(actual, await readFile('cloudflare/migrations/0013_banner_management.sql', 'utf8'));
  await apply(actual, await readFile('cloudflare/migrations/0014_staff_portfolio.sql', 'utf8'));
  await apply(actual, await readFile('cloudflare/migrations/0015_appointment_order_number.sql', 'utf8'));
  const [backfill, ...requiredTriggers] = (await readFile('cloudflare/migrations/0016_require_appointment_order_number.sql', 'utf8')).split(/(?=CREATE TRIGGER)/);
  await apply(actual, backfill);
  for (const trigger of requiredTriggers) await actual.prepare(trigger).run();
  await apply(actual, await readFile('cloudflare/migrations/0017_payment_order_number.sql', 'utf8'));
  await apply(actual, await readFile('cloudflare/migrations/0018_backfill_payment_order_numbers.sql', 'utf8'));
  await apply(actual, await readFile('cloudflare/migrations/0019_brand_email_settings.sql', 'utf8'));
  await apply(actual, await readFile('cloudflare/migrations/0020_email_outbox.sql', 'utf8'));
  await apply(actual, await readFile('cloudflare/migrations/0021_email_provider_configuration.sql', 'utf8'));
  await apply(actual, await readFile('cloudflare/migrations/0022_email_outbox_delivery_fence.sql', 'utf8'));
  await apply(actual, await readFile('cloudflare/migrations/0023_email_outbox_management.sql', 'utf8'));
  await apply(actual, await readFile('cloudflare/migrations/0024_retire_business_email_events.sql', 'utf8'));
  await apply(actual, await readFile('cloudflare/migrations/0025_unified_merchant_email.sql', 'utf8'));
  await apply(actual, await readFile('cloudflare/migrations/0026_email_enabled_default.sql', 'utf8'));
  // v16 enforces this required field with triggers to retain the referenced table.
  // Verify both exact definitions before treating their enforcement as NOT NULL.
  for (const trigger of requiredTriggers) {
    const name = trigger.match(/CREATE TRIGGER "([^"]+)"/)[1];
    const stored = await actual.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?").bind(name).first();
    assert.equal(stored.sql.replace(/;\s*$/, '').trim(), trigger.replace(/;\s*$/, '').trim());
  }
  const fingerprint = async db => {
    const tables = (await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").all()).results;
    const result = {};
    const sort = rows => rows.map(row => JSON.stringify(row)).sort();
    for (const { name } of tables) {
      const quoted = '"' + name.replaceAll('"', '""') + '"';
      const columns = (await db.prepare(`PRAGMA table_info(${quoted})`).all()).results.map(({ cid, ...row }) => row);
      if (db === actual && name === 'Appointment') {
        columns.find(column => column.name === 'orderNumber').notnull = 1;
      }
      const foreignKeys = (await db.prepare(`PRAGMA foreign_key_list(${quoted})`).all()).results.map(({ id, ...row }) => row);
      const indexes = (await db.prepare(`PRAGMA index_list(${quoted})`).all()).results;
      const indexDefinitions = [];
      for (const index of indexes) {
        const info = (await db.prepare(`PRAGMA index_info("${index.name.replaceAll('"', '""')}")`).all()).results.map(({ cid, ...row }) => row);
        indexDefinitions.push({ name: index.name, unique: index.unique, origin: index.origin, partial: index.partial, columns: info });
      }
      result[name] = { columns: sort(columns), foreignKeys: sort(foreignKeys), indexes: sort(indexDefinitions) };
    }
    return result;
  };
  assert.deepEqual(await fingerprint(actual), await fingerprint(expected), 'Cloudflare schema drift detected. Add a versioned SQLite migration; never overwrite applied migrations.');
  console.log('Cloudflare schema and versioned SQLite migrations match.');
} finally { await mf.dispose(); }
