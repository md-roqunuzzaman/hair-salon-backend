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
  const fingerprint = async db => {
    const tables = (await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").all()).results;
    const result = {};
    const sort = rows => rows.map(row => JSON.stringify(row)).sort();
    for (const { name } of tables) {
      const quoted = '"' + name.replaceAll('"', '""') + '"';
      const columns = (await db.prepare(`PRAGMA table_info(${quoted})`).all()).results.map(({ cid, ...row }) => row);
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
