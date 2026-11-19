
import { readFile, mkdir, writeFile } from 'node:fs/promises';

const sourcePath = 'platform/prisma/schema.prisma';
const outputPath = 'platform/runtime/model-metadata.json';

const source = await readFile(sourcePath, 'utf8');

const modelNames = [
  ...source.matchAll(/\bmodel\s+(\w+)\s*\{/g),
].map(match => match[1]);

const metadata = {};

for (const match of source.matchAll(
  /\bmodel\s+(\w+)\s*\{([\s\S]*?)\n\}/g
)) {
  const modelName = match[1];

  const model = {
    money: {},
    relations: {},
    arrays: [],
    scalars: {},
  };

  for (const line of match[2].split('\n')) {
    const field = line.trim().match(
      /^(\w+)\s+(\w+)(\[\]|\?)?(.*)$/
    );

    if (!field) continue;

    const [, name, type, suffix] = field;

    if (modelNames.includes(type)) {
      model.relations[name] = type;
    } else {
      model.scalars[name] = type;
    }

    if (suffix === '[]' && !modelNames.includes(type)) {
      model.arrays.push(name);
    }
  }

  metadata[modelName] = model;
}

if (Object.keys(metadata).length !== modelNames.length) {
  throw new Error('Platform model metadata generation incomplete');
}

await mkdir('platform/runtime', { recursive: true });

await writeFile(
  outputPath,
  `${JSON.stringify(metadata, null, 2)}\n`
);

console.log(
  `Platform metadata generated for ${modelNames.length} models`
);
