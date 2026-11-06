// Local artifact inspection only: no environment/credentials, network or deployment.
import assert from 'node:assert/strict';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import migrations from '../cloudflare/.build/migrations.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const packageLock = await readFile('package-lock.json');
const phonePackage = JSON.parse(await readFile('node_modules/libphonenumber-js/package.json','utf8'));
assert.equal(JSON.parse(packageLock).packages['node_modules/libphonenumber-js'].version,phonePackage.version,'Phone package must match the lockfile');
const toolPackages = await Promise.all(['wrangler','miniflare','esbuild','prisma'].map(async name =>
  [name, JSON.parse(await readFile(`node_modules/${name}/package.json`,'utf8'))]));
const tooling = Object.fromEntries(toolPackages);
assert.equal(tooling.miniflare.version, tooling.wrangler.dependencies.miniflare, 'Tests and Wrangler must use the same Miniflare version');
const toolVersions = Object.fromEntries(toolPackages.map(([name, value])=>[name,value.version]));
const config = JSON.parse(await readFile('wrangler.jsonc','utf8'));
assert.equal(config.vars.EMAIL_OUTBOX_ENABLED,'false');
assert.ok(['false','true'].includes(config.env.staging.vars.EMAIL_OUTBOX_ENABLED));
assert.equal(config.main,'cloudflare/.build/worker.mjs');
assert.equal(migrations.length,36);
assert.match(migrations[35].sql, /ALTER TABLE "Appointment" ADD COLUMN "timezone" TEXT/);
assert.match(migrations[35].sql, /ALTER TABLE "GroupPurchase" ADD COLUMN "currency" TEXT/);
assert.match(migrations[34].sql, /ADD COLUMN "countryCode"/);
assert.match(migrations[34].sql, /ADD COLUMN "currency"/);
assert.match(migrations[34].sql, /ADD COLUMN "timezone"/);
assert.match(migrations[33].sql, /CREATE TABLE "BranchPortfolioCase"/);
assert.match(migrations[32].sql, /CREATE TABLE "BranchBusinessBreak"/);
assert.match(migrations[31].sql, /CREATE INDEX "Branch_status_latitude_longitude_idx"/);
assert.match(migrations[31].sql, /CREATE INDEX "EmailOutbox_status_lockedUntil_idx"/);
// Prior versioned SQL may still be uncommitted locally. Protect the prior
// release manifest's migration history as well as the committed HEAD.
let previousRelease;
try { previousRelease=JSON.parse(await readFile('cloudflare/.build/unified-merchant-email-release-manifest.json','utf8')); }
catch (error) { if(error.code!=='ENOENT')throw error; }
for(const prior of previousRelease?.migrationChecksums??[])assert.equal(migrations[prior.version-1]?.checksum,prior.checksum,`Prior migration checksum changed: v${prior.version}`);
const immutable = [];
for (const directory of ['cloudflare/migrations','prisma/migrations']) {
  for (const name of await readdir(directory)) {
    if (name.endsWith('.toml')) continue;
    if (name.startsWith('0025_') || name === '20261029090000_unified_merchant_email') continue;
    if (name.startsWith('0026_') || name === '20261029100000_email_enabled_default') continue;
    if (name.startsWith('0027_') || ['20261029100537_add_banner_carousel_settings','20261029101521_add_branch_carousel_settings'].includes(name)) continue;
    if (name.startsWith('0028_') || ['20261030014939_add_email_verification','20261030020000_preserve_existing_customer_access'].includes(name)) continue;
    if (name.startsWith('0029_') || name === '20261030060000_policy_time_minutes') continue;
    if(name.startsWith('0030_')||name==='20261030100000_refund_allocations')continue;
    if(name==='0031_group_purchase_valid_days_snapshot.sql'||name==='20261030110000_group_purchase_valid_days_snapshot')continue;
    if(name==='0032_branch_location_outbox_lock_indexes.sql')continue;
    if(name==='0033_branch_business_break.sql'||name==='20261103015042_add_branch_business_break')continue;
    if(name==='0034_branch_portfolio.sql'||['20261103082916_add_branch_portfolio','20261103084502_add_staff_portfolio_branch_relation'].includes(name))continue;
    if(name==='0035_brand_international_settings.sql'||name==='20261105023508_add_brand_international_settings')continue;
    if(name==='0036_international_transaction_snapshots.sql'||name==='20261105060000_international_transaction_snapshots')continue;
    // Current PostgreSQL index candidates are retained verbatim; Workers use v32 SQLite.
    if(directory==='prisma/migrations'&&['20261102082512_email_outbox_stale_lock_index','20261102083831_email_outbox_stale_lock_index'].includes(name))continue;
    const file = `${directory}/${name}${directory.startsWith('prisma')?'/migration.sql':''}`;
    if (!file.endsWith('.sql')) continue;
    const baseline = execFileSync('git',['show',`HEAD:${file}`],{encoding:'utf8',windowsHide:true});
    const current = await readFile(file,'utf8');
    assert.equal(current.replaceAll('\r\n','\n'),baseline.replaceAll('\r\n','\n'),`Historical migration changed: ${file}`);
    immutable.push(file);
  }
}
const metadata=JSON.parse(await readFile('cloudflare/runtime/model-metadata.json','utf8'));
assert.equal(metadata.Appointment.scalars.timezone,'String');
assert.equal(metadata.GroupPurchase.scalars.currency,'String');
for(const field of ['countryCode','currency','timezone'])assert.equal(metadata.Brand.scalars[field],'String');
assert.equal(metadata.BranchPortfolioCase.relations.branch,'Branch');
assert.equal(metadata.BranchPortfolioCase.relations.images,'BranchPortfolioCaseImage');
assert.equal(metadata.StaffPortfolioCase.relations.branch,'Branch');
assert.equal(metadata.StaffPortfolioCase.scalars.showInBranchPortfolio,'Boolean');
assert.equal(metadata.BranchBusinessBreak.relations.businessHour,'BranchBusinessHour','Break parent relation missing from Worker metadata');
assert.equal(metadata.BranchBusinessHour.relations.breaks,'BranchBusinessBreak','Break child relation missing from Worker metadata');
assert.equal(metadata.BranchBusinessBreak.scalars.startTime,'String','Break time missing from Worker metadata');
assert.equal(metadata.GroupPurchase.scalars.validDaysSnapshot,'Int','Snapshot field missing from Worker adapter metadata');
const bundle = await readFile(config.main);
assert.ok(!bundle.includes('INTERNATIONAL_TEST_TENCENT_STUB'),'International test provider leaked into production Worker');
assert.ok(!bundle.includes('__login-rate-test'),'Login test control leaked into production Worker');
assert.ok(!bundle.includes('__auth-session-test'),'Session test control leaked into production Worker');
const map = JSON.parse(await readFile(`${config.main}.map`,'utf8'));
assert.ok(map.sources.some(source=>source.includes('libphonenumber-js/')&&source.endsWith('metadata.min.json.js')),'International phone metadata missing from production Worker');
for(const required of ['module/auth/auth.service.ts','module/auth/auth.validation.ts','module/user/user.service.ts','module/user/user.validation.ts'])assert.ok(map.sources.some(source=>source.endsWith(required)),`Phone runtime source missing: ${required}`);
assert.ok(!map.sources.some(source=>source.includes('libphonenumber-js/examples')),'Synthetic phone example data leaked into production Worker');
assert.ok(map.sources.some(source=>source.endsWith('src/app/lib/tencent-moderation.ts')), 'Worker-compatible Tencent transport missing');
for (const excluded of ['tencentcloud-sdk-nodejs','runtime/security-fixture.mjs','test-support/tencent-responses.mjs']) assert.ok(!map.sources.some(source=>source.includes(excluded)),`Unsupported moderation production source: ${excluded}`);
assert.ok(!map.sources.some(source=>source.endsWith('runtime/international-provider-stub.mjs')), 'International test provider source leaked into production Worker');
for (const required of ['utils/transaction-currency.utils.ts','utils/appointment-timezone.utils.ts','utils/brand-timezone.utils.ts']) assert.ok(map.sources.some(source=>source.endsWith(required)),`Missing international runtime source: ${required}`);
assert.ok(map.sources.some(source=>source.endsWith('runtime/sqlite-errors.mjs')), 'SQLite error compatibility normalizer missing');
assert.ok(map.sources.some(source=>source.endsWith('utils/auth-session.ts')), 'Active-session enforcement missing');
assert.ok(!map.sources.some(source=>source.endsWith('runtime/auth-session-fixture.mjs')), 'Session fixture leaked into production Worker');
for (const required of ['brand-email-setting.sender.ts','brand-email-setting.auth.ts','brand-email-setting.events.ts','brand-email-setting.outbox-processor.ts','banner.service.ts','registration-rate-limit.ts','login-rate-limit.ts','runtime/request-client-ip.mjs','runtime/sessions.mjs']) assert.ok(map.sources.some(source=>source.endsWith(required)),`Missing ${required}`);
assert.ok((await readFile('cloudflare/.build/templates.mjs','utf8')).includes('"verify-email.ejs"'),'Verification template missing from compiled templates');
// MIME composition is intentionally shared by Worker SMTP and Graph. Only the
// native Node SMTP transport/connection and local fixtures must be absent.
for (const excluded of ['runtime/integration-fixture.mjs','runtime/business-email-fixture.mjs','runtime/email-test-fixture.mjs','src/app/lib/merchant-smtp.ts','nodemailer/dist/esm/smtp-transport/','nodemailer/dist/esm/smtp-connection/','nodemailer/lib/smtp-transport/','nodemailer/lib/smtp-connection/']) assert.ok(!map.sources.some(source=>source.includes(excluded)),`Unsupported production source: ${excluded}`);
const report = {
  scope:'LOCAL_ONLY_NO_DEPLOY',createdAt:new Date().toISOString(),
  packageLockSha256:hash(packageLock),nodeVersion:process.version,toolVersions,
  workerSha256:hash(bundle),workerBytes:bundle.length,
  migrationVersion:migrations.at(-1).version,
  migrationChecksums:migrations.map(({version,checksum})=>({version,checksum})),
  historicalMigrationFilesUnchanged:immutable.length,
  stagingBusinessDelivery:config.env.staging.vars.EMAIL_OUTBOX_ENABLED==='true',productionBusinessDelivery:false,
  merchantOnlyRoutingIncluded:true,nativeSmtpAndTestFixturesExcluded:true,
  registrationVerificationIncluded:true,groupPurchaseValiditySnapshotIncluded:true,loginRateLimitingIncluded:true,
  internationalPhoneIncluded:true,phoneNumberVersion:phonePackage.version,
};
await writeFile('cloudflare/.build/unified-merchant-email-release-manifest.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({scope:report.scope,migrationVersion:report.migrationVersion,historicalMigrationFilesUnchanged:immutable.length,workerBytes:bundle.length,stagingBusinessDelivery:report.stagingBusinessDelivery,productionBusinessDelivery:false,bundleIsolation:true}));
