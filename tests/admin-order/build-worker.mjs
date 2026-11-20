import { build } from 'esbuild';
import path from 'node:path';
import { builtinModules } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';

// Test-only bundling; reuses generated assets from the existing --test build.
const aliases = {
  'src/app/lib/prisma.ts': 'cloudflare/runtime/prisma.mjs',
  'src/app/lib/request-client-ip.ts': 'cloudflare/runtime/request-client-ip.mjs',
  'src/app/lib/redis.ts': 'cloudflare/runtime/redis.mjs',
  'src/app/lib/nodemailer.ts': 'cloudflare/runtime/nodemailer.mjs',
  'src/app/lib/merchant-smtp.ts': 'cloudflare/runtime/merchant-smtp.mjs',
  'src/app/config/env.ts': 'cloudflare/runtime/env.mjs',
  'generated/prisma/client.ts': 'generated/sqlite/client.ts',
  'generated/prisma/enums.ts': 'generated/sqlite/enums.ts',
};
const builtinSet = new Set(builtinModules.map(n => n.replace(/^node:/, '')));
const used = new Set();
const baseline = process.argv.includes('--without-admin-order-router');
const outfile = baseline ? 'cloudflare/.build/admin-order-baseline.mjs' : 'cloudflare/.build/admin-order-tests.mjs';
await build({ entryPoints: [baseline ? 'cloudflare/runtime/integration-fixture.mjs' : 'tests/admin-order/worker-fixture.mjs'], outfile, bundle: true,
  format: 'esm', platform: 'browser', mainFields: ['browser', 'module', 'main'], target: 'es2022', conditions: ['workerd', 'worker', 'browser'],
  external: ['node:*', 'cloudflare:*', './compiler.wasm'], loader: { '.sql': 'text' }, minify: true,
  plugins: [{ name: 'admin-order-test-only', setup(builder) {
    if (baseline) builder.onLoad({ filter: /[\\/]src[\\/]app\.ts$/ }, async args => ({
      contents: (await readFile(args.path, 'utf8')).replace(/^import \{ AdminOrderRoutes \}.*\r?\n/m, '')
        .replace(/^app\.use\("\/api\/v1\/admin\/orders", AdminOrderRoutes\);\r?\n/m, ''), loader: 'ts',
    }));
    builder.onResolve({ filter: /./ }, args => {
      const name = args.path.replace(/^node:/, '');
      if (builtinSet.has(name)) { used.add(name); return { path: 'node:' + name, external: true }; }
      if (/query_compiler_fast_bg\.wasm\?module$/.test(args.path)) return { path: './compiler.wasm', external: true };
      if (args.path === 'bcrypt') return { path: path.resolve('node_modules/bcryptjs/index.js') };
      if (args.path === 'ejs') return { path: path.resolve('cloudflare/.build/templates.mjs') };
      const resolved = path.relative(process.cwd(), path.resolve(args.resolveDir, args.path)).replaceAll('\\', '/').replace(/\.js$/, '.ts');
      if (aliases[resolved]) return { path: path.resolve(aliases[resolved]) };
    });
  } }],
});
const names = [...used];
const imports = names.map((n, i) => `import * as adminOrderBuiltin${i} from 'node:${n}';`).join('\n');
const map = names.map((n, i) => `${JSON.stringify(n)}:adminOrderBuiltin${i}.default??adminOrderBuiltin${i},${JSON.stringify('node:' + n)}:adminOrderBuiltin${i}.default??adminOrderBuiltin${i}`).join(',');
await writeFile(outfile, `${imports}\nconst builtins={${map}};const require=name=>{if(!(name in builtins))throw new Error('Unsupported builtin');return builtins[name]};\n` + await readFile(outfile, 'utf8'));
console.log('Disposable Admin Order Worker built');
