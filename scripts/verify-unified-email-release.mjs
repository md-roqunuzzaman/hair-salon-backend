// Local artifact inspection only: no environment/credentials, network or deployment.
import assert from 'node:assert/strict';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import migrations from '../cloudflare/.build/migrations.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const config = JSON.parse(await readFile('wrangler.jsonc','utf8'));
assert.equal(config.vars.EMAIL_OUTBOX_ENABLED,'false');
assert.ok(['false','true'].includes(config.env.staging.vars.EMAIL_OUTBOX_ENABLED));
assert.equal(config.main,'cloudflare/.build/worker.mjs');
assert.equal(migrations.length,26);
// v25 may still be uncommitted locally but is already deployed. When a prior
// release manifest exists, protect its entire applied history as well as HEAD.
let previousRelease;
try { previousRelease=JSON.parse(await readFile('cloudflare/.build/unified-merchant-email-release-manifest.json','utf8')); }
catch (error) { if(error.code!=='ENOENT')throw error; }
for(const prior of previousRelease?.migrationChecksums??[])if(prior.version<=25)assert.equal(migrations[prior.version-1]?.checksum,prior.checksum,`Applied migration checksum changed: v${prior.version}`);
const immutable = [];
for (const directory of ['cloudflare/migrations','prisma/migrations']) {
  for (const name of await readdir(directory)) {
    if (name.endsWith('.toml')) continue;
    if (name.startsWith('0025_') || name === '20261029090000_unified_merchant_email') continue;
    if (name.startsWith('0026_') || name === '20261029100000_email_enabled_default') continue;
    const file = `${directory}/${name}${directory.startsWith('prisma')?'/migration.sql':''}`;
    if (!file.endsWith('.sql')) continue;
    const baseline = execFileSync('git',['show',`HEAD:${file}`],{encoding:'utf8',windowsHide:true});
    const current = await readFile(file,'utf8');
    assert.equal(current.replaceAll('\r\n','\n'),baseline.replaceAll('\r\n','\n'),`Historical migration changed: ${file}`);
    immutable.push(file);
  }
}
const bundle = await readFile(config.main);
const map = JSON.parse(await readFile(`${config.main}.map`,'utf8'));
for (const required of ['brand-email-setting.sender.ts','brand-email-setting.auth.ts','brand-email-setting.events.ts','brand-email-setting.outbox-processor.ts']) assert.ok(map.sources.some(source=>source.endsWith(required)),`Missing ${required}`);
// MIME composition is intentionally shared by Worker SMTP and Graph. Only the
// native Node SMTP transport/connection and local fixtures must be absent.
for (const excluded of ['runtime/integration-fixture.mjs','runtime/business-email-fixture.mjs','runtime/email-test-fixture.mjs','src/app/lib/merchant-smtp.ts','nodemailer/dist/esm/smtp-transport/','nodemailer/dist/esm/smtp-connection/','nodemailer/lib/smtp-transport/','nodemailer/lib/smtp-connection/']) assert.ok(!map.sources.some(source=>source.includes(excluded)),`Unsupported production source: ${excluded}`);
const report = {
  scope:'LOCAL_ONLY_NO_DEPLOY',createdAt:new Date().toISOString(),
  workerSha256:hash(bundle),workerBytes:bundle.length,
  migrationVersion:migrations.at(-1).version,
  migrationChecksums:migrations.map(({version,checksum})=>({version,checksum})),
  historicalMigrationFilesUnchanged:immutable.length,
  stagingBusinessDelivery:config.env.staging.vars.EMAIL_OUTBOX_ENABLED==='true',productionBusinessDelivery:false,
  merchantOnlyRoutingIncluded:true,nativeSmtpAndTestFixturesExcluded:true,
};
await writeFile('cloudflare/.build/unified-merchant-email-release-manifest.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({scope:report.scope,migrationVersion:report.migrationVersion,historicalMigrationFilesUnchanged:immutable.length,workerBytes:bundle.length,stagingBusinessDelivery:report.stagingBusinessDelivery,productionBusinessDelivery:false,bundleIsolation:true}));
