import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';

const files = (await readdir('prisma/schema')).filter(f => f.endsWith('.prisma')).sort();
const source = (await Promise.all(files.map(f => readFile(`prisma/schema/${f}`, 'utf8')))).join('\n');
const modelNames = [...source.matchAll(/model\s+(\w+)\s*\{/g)].map(m => m[1]);
const enumNames = [...source.matchAll(/enum\s+(\w+)\s*\{/g)].map(m => m[1]);
const metadata = {};
for (const match of source.matchAll(/model\s+(\w+)\s*\{([\s\S]*?)\n\}/g)) {
  const model = { money: {}, relations: {}, arrays: [], scalars: {} };
  for (const line of match[2].split('\n')) {
    const field = line.trim().match(/^(\w+)\s+(\w+)(\[\]|\?)?(.*)$/);
    if (!field) continue;
    const [, name, type, suffix, attributes] = field;
    if (!modelNames.includes(type)) model.scalars[name] = type;
    if (type === 'Decimal') {
      const precision = Number(attributes.match(/@db\.Decimal\((\d+),/)?.[1] ?? 10);
      model.money[name] = { scale: 2, max: '9'.repeat(precision) };
    }
    if (modelNames.includes(type)) model.relations[name] = type;
    if (suffix === '[]' && !modelNames.includes(type)) model.arrays.push(name);
  }
  metadata[match[1]] = model;
}
let schema = source.replace(/generator client\s*\{[\s\S]*?\}/, `generator client {
  provider = "prisma-client"
  output = "../../generated/sqlite"
  runtime = "cloudflare"
}`).replace('provider = "postgresql"', 'provider = "sqlite"');
schema = schema.replace(/^(\s*\w+\s+)Decimal(\??)(.*)$/gm, (_, prefix, optional, tail) =>
  `${prefix}BigInt${optional}${tail.replace(/@db\.Decimal\([^)]*\)/g, '')}`);
// SQLite stores PostgreSQL varchar fields as text; retain nullable/unique attributes.
schema = schema.replace(/@db\.VarChar\(\d+\)/g, '');
schema = schema.replace(/^(\s*\w+\s+)(\w+)\[\](.*)$/gm, (line, prefix, type, tail) => {
  if (modelNames.includes(type)) return line;
  if (type !== 'String' && !enumNames.includes(type)) throw new Error(`Unsupported scalar array: ${type}`);
  const defaults = tail.match(/@default\(\[([^\]]*)\]\)/)?.[1]?.trim();
  const values = defaults ? defaults.split(',').map(s => s.trim().replace(/^"|"$/g, '')) : [];
  return `${prefix}Json${tail.replace(/@default\(\[[^\]]*\]\)/, `@default(${JSON.stringify(JSON.stringify(values))})`)}`;
});
await mkdir('cloudflare/prisma', { recursive: true });
await mkdir('cloudflare/runtime', { recursive: true });
await writeFile('cloudflare/prisma/schema.prisma', schema.replace(/[ \t]+$/gm, ''));
await writeFile('cloudflare/runtime/model-metadata.json', `${JSON.stringify(metadata, null, 2)}\n`);
