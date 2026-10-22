import { build } from 'esbuild';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import ejs from 'ejs';
import { builtinModules } from 'node:module';
import { createHash } from 'node:crypto';
import metadata from '../cloudflare/runtime/model-metadata.json' with { type: 'json' };

const directory = 'cloudflare/.build';
const integration = process.argv.includes('--test');
const outputName = integration ? 'integration' : 'worker';
await mkdir(directory, { recursive: true });
const templates = [];
for (const name of ['forgot-password', 'reset-password']) {
  const source = await readFile(`src/app/templates/${name}.ejs`, 'utf8');
  const pieces = [];
  let offset = 0;
  for (const match of source.matchAll(/<%=\s*(\w+)\s*%>/g)) {
    pieces.push(JSON.stringify(source.slice(offset, match.index)), `escape(data[${JSON.stringify(match[1])}])`);
    offset = match.index + match[0].length;
  }
  pieces.push(JSON.stringify(source.slice(offset)));
  if (source.replace(/<%=\s*\w+\s*%>/g, '').includes('<%')) throw new Error(`Unsupported EJS syntax in ${name}`);
  templates.push(`${JSON.stringify(`${name}.ejs`)}: data => ${pieces.join(' + ')}`);
}
await writeFile(`${directory}/templates.mjs`, `const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&#34;',"'":'&#39;'}[char]));\nconst templates = {${templates.join(',\n')}};\nexport default { async renderFile(file, data) { const name = file.split(/[\\\\/]/).pop(); if (!templates[name]) throw new Error('Unknown email template'); return templates[name](data); } };\n`);
const { default: compiledTemplates } = await import(`../${directory}/templates.mjs?${Date.now()}`);
for (const name of ['forgot-password', 'reset-password']) {
  const data = { name: '<b>Test & "name"</b>', otp: '123456', expirationMinutes: 5 };
  const original = ejs.render(await readFile(`src/app/templates/${name}.ejs`, 'utf8'), data);
  if (await compiledTemplates.renderFile(`${name}.ejs`, data) !== original) throw new Error(`Email template parity failed: ${name}`);
}
let migration = await readFile('cloudflare/migrations/0001_initial.sql', 'utf8');
const initialSql = migration;
for (const [model, info] of Object.entries(metadata)) {
  for (const [field, { max }] of Object.entries(info.money)) {
    const tableSql = initialSql.split(`CREATE TABLE "${model}" (`)[1]?.split('\n);')[0] ?? '';
    if (!tableSql.includes(`"${field}" `)) continue;
    for (const event of ['INSERT', 'UPDATE']) {
      migration += `\nCREATE TRIGGER "money_${model}_${field}_${event}" BEFORE ${event} ON "${model}" WHEN NEW."${field}" IS NOT NULL AND (typeof(NEW."${field}") != 'integer' OR abs(NEW."${field}") > ${max}) BEGIN SELECT RAISE(ABORT, 'Money precision exceeded'); END;\n`;
    }
  }
}
await writeFile(`${directory}/migration.sql`, migration);
const upgrade = await readFile('cloudflare/migrations/0002_wallet_topup_promotion.sql', 'utf8');
const qrUpgrade = await readFile('cloudflare/migrations/0003_branch_qr_verification_rule.sql', 'utf8');
let unified = await readFile('cloudflare/migrations/0004_unified_group_purchase.sql', 'utf8');
for (const field of ['depositPercentage', 'depositAmount', 'remainingAmount']) {
  const max = metadata.GroupPurchase.money[field].max;
  for (const event of ['INSERT', 'UPDATE']) unified += `\nCREATE TRIGGER "money_GroupPurchase_${field}_${event}" BEFORE ${event} ON "GroupPurchase" WHEN NEW."${field}" IS NOT NULL AND (typeof(NEW."${field}") != 'integer' OR abs(NEW."${field}") > ${max}) BEGIN SELECT RAISE(ABORT, 'Money precision exceeded'); END;\n`;
}
const attemptFence = await readFile('cloudflare/migrations/0005_refund_attempt_fence.sql', 'utf8');
const settlementIdentity = await readFile('cloudflare/migrations/0006_group_settlement_identity.sql', 'utf8');
const branchCoordinates = await readFile('cloudflare/migrations/0007_branch_coordinates.sql', 'utf8');
const migrations = [migration, upgrade, qrUpgrade, unified, attemptFence, settlementIdentity, branchCoordinates].map((sql, index) => ({ version: index + 1, sql, checksum: createHash('sha256').update(sql).digest('hex') }));
await writeFile(`${directory}/migrations.mjs`, `export default ${JSON.stringify(migrations)};\n`);

await writeFile(`${directory}/migration-meta.mjs`, `export const migrationDigest = ${JSON.stringify(createHash('sha256').update(migration).digest('hex'))};\n`);
await copyFile('generated/sqlite/internal/query_compiler_fast_bg.wasm', `${directory}/compiler.wasm`);
const aliases = {
  'src/app/lib/prisma.ts': 'cloudflare/runtime/prisma.mjs',
  'src/app/lib/redis.ts': 'cloudflare/runtime/redis.mjs',
  'src/app/lib/nodemailer.ts': 'cloudflare/runtime/nodemailer.mjs',
  'src/app/config/env.ts': 'cloudflare/runtime/env.mjs',
  'generated/prisma/client.ts': 'generated/sqlite/client.ts',
  'generated/prisma/enums.ts': 'generated/sqlite/enums.ts',
};
const builtinSet = new Set(builtinModules.map(name => name.replace(/^node:/, '')));
const usedBuiltins = new Set();
await build({
  entryPoints: [integration ? 'cloudflare/runtime/integration-fixture.mjs' : 'cloudflare/worker.mjs'], outfile: `${directory}/${outputName}.mjs`, bundle: true,
  format: 'esm', platform: 'browser', mainFields: ['browser', 'module', 'main'], target: 'es2022', conditions: ['workerd', 'worker', 'browser'],
  external: ['node:*', 'cloudflare:*', './compiler.wasm'], loader: { '.sql': 'text' },
  minify: true, sourcemap: true,
  plugins: [{ name: 'cloudflare-runtime', setup(builder) {
    builder.onResolve({ filter: /./ }, args => {
      const name = args.path.replace(/^node:/, '');
      if (builtinSet.has(name)) {
        usedBuiltins.add(name);
        return { path: `node:${name}`, external: true };
      }
    });
    builder.onResolve({ filter: /query_compiler_fast_bg\.wasm\?module$/ }, () => ({ path: './compiler.wasm', external: true }));
    builder.onResolve({ filter: /^bcrypt$/ }, () => ({ path: path.resolve('node_modules/bcryptjs/index.js') }));
    builder.onResolve({ filter: /^ejs$/ }, () => ({ path: path.resolve(`${directory}/templates.mjs`) }));
    builder.onResolve({ filter: /(?:prisma|redis|nodemailer|env|client|enums)\.js$/ }, args => {
      const resolved = path.relative(process.cwd(), path.resolve(args.resolveDir, args.path)).replaceAll('\\', '/').replace(/\.js$/, '.ts');
      if (aliases[resolved]) return { path: path.resolve(aliases[resolved]) };
    });
  } }],
});
const builtins = [...usedBuiltins].sort();
const builtinImports = builtins.map((name, index) => `import * as builtin${index} from 'node:${name}';`).join('\n');
const builtinMap = builtins.map((name, index) => `${JSON.stringify(name)}: builtin${index}.default ?? builtin${index}, ${JSON.stringify(`node:${name}`)}: builtin${index}.default ?? builtin${index}`).join(',');
const prefix = `${builtinImports}\nconst builtinMap = {${builtinMap}};\nconst require = name => { if (!(name in builtinMap)) throw new Error('Unsupported dynamic import: ' + name); return builtinMap[name]; };\n`;
const bundle = await readFile(`${directory}/${outputName}.mjs`, 'utf8');
await writeFile(`${directory}/${outputName}.mjs`, prefix + bundle);
const map = JSON.parse(await readFile(`${directory}/${outputName}.mjs.map`, 'utf8'));
map.mappings = ';'.repeat(prefix.split('\n').length - 1) + map.mappings;
await writeFile(`${directory}/${outputName}.mjs.map`, JSON.stringify(map));
console.log('Cloudflare Worker built. PostgreSQL, Redis TCP, native bcrypt are excluded; email uses TLS SMTP.');
