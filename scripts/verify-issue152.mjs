// Local-only release evidence. Each command's complete output and exit code are retained.
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
const directory = 'node_modules/.cloudflare-test/issue152';
await mkdir(directory, { recursive: true });
const [suite, label = 'current'] = process.argv.slice(2);
const suites = {
  schema: [
    ['node_modules/prisma/build/index.js','generate','--config','cloudflare/node-client.config.ts'],
    ['node_modules/typescript/bin/tsc','--noEmit'],
    ['node_modules/prisma/build/index.js','validate','--config','cloudflare/node-client.config.ts'],
    ['scripts/prepare-cloudflare.mjs'],
    ['node_modules/prisma/build/index.js','validate','--config','cloudflare/prisma.config.ts'],
    ['node_modules/prisma/build/index.js','generate','--config','cloudflare/prisma.config.ts'],
    ['scripts/check-cloudflare-schema.mjs'],
    ['scripts/build-cloudflare.mjs'],
    ['scripts/test-cloudflare-migrations.mjs'],
    ['scripts/verify-unified-email-release.mjs'],
  ],
  production: [['--test','cloudflare/tencent-production.integration.test.mjs']],
  dryrun: [['node_modules/wrangler/bin/wrangler.js','deploy','--dry-run','--env','staging']],
  payments: [['scripts/build-cloudflare.mjs','--test'],['--test','cloudflare/remaining-payment.integration.test.mjs']],
  focused: [['scripts/build-cloudflare.mjs','--test'],['--test','cloudflare/optional-staff.integration.test.mjs']],
  worker: [['scripts/build-cloudflare.mjs','--test'],['--import','tsx','--test','--test-concurrency=1',...['optional-staff','staff-schedule','staff-availability','no-show','branch-limit','security','tencent-transport','outer-error-security'].map(name => `cloudflare/${name}.integration.test.mjs`)]],
  booking: [['--import','tsx','--test','cloudflare/booking-regression.test.mjs','cloudflare/staff-availability-regression.test.mjs','cloudflare/staff-schedule-regression.test.mjs','cloudflare/no-show-regression.test.mjs']],
  api: [['scripts/build-cloudflare.mjs','--test'],['--test',...['runtime','remaining-payment','banner-carousel','branch-breaks','registration-email','login-rate-limit','password-change','auth-session','service-search','my-orders'].map(name => `cloudflare/${name}.integration.test.mjs`)]],
};
if (!suites[suite]) throw new Error(`Choose one of: ${Object.keys(suites).join(', ')}`);
let output = '';
let code = 0;
for (const args of suites[suite]) {
  console.log(`Running ${suite}: ${args.join(' ')}`);
  code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { windowsHide: true });
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { output += data; });
    child.on('error', reject);
    child.on('close', resolve);
  });
  if (code !== 0) break;
}
const prefix = `${directory}/${suite}-${label}`;
await writeFile(`${prefix}.log`, output);
const summary = { suite, label, exitCode: code, counts: output.split(/\r?\n/).filter(line => /^# (tests|pass|fail|cancelled|skipped|todo) /.test(line)), failures: output.split(/\r?\n/).filter(line => /^\s*not ok /.test(line)), log: `${prefix}.log` };
await writeFile(`${prefix}.json`, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
process.exitCode = code;
