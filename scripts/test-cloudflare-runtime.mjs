import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { mkdir, copyFile, readFile } from 'node:fs/promises';
await mkdir('node_modules/.cloudflare-test', { recursive: true });
await copyFile('generated/sqlite/internal/query_compiler_fast_bg.wasm', 'node_modules/.cloudflare-test/compiler.wasm');
await build({
  entryPoints: ['cloudflare/runtime/database-fixture.mjs'], outfile: 'node_modules/.cloudflare-test/worker.mjs',
  bundle: true, format: 'esm', platform: 'neutral', conditions: ['workerd', 'worker', 'browser'],
  external: ['node:*', './compiler.wasm'], loader: { '.sql': 'text' },
  plugins: [{ name: 'wasm', setup(build) {
    build.onResolve({ filter: /query_compiler_fast_bg\.wasm\?module$/ }, () => ({ path: './compiler.wasm', external: true }));
  } }],
});
const mf = new Miniflare({
  modules: true, scriptPath: 'node_modules/.cloudflare-test/worker.mjs',
  compatibilityDate: '2025-07-18', compatibilityFlags: ['nodejs_compat'],
  modulesRules: [{ type: 'CompiledWasm', include: ['**/*.wasm'] }],
  durableObjects: { DB: { className: 'DatabaseFixture', useSQLite: true } },
});
try {
  const response = await mf.dispatchFetch('https://test/');
  const result = await response.json();
  console.log(JSON.stringify(result));
  if (!response.ok || !result.rolledBack) process.exitCode = 1;
} finally { await mf.dispose(); }
