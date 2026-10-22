import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { localPath, validate, validateMetadata, expected, rehearse } from '../scripts/rehearse-staging-recovery.mjs';

test('recovery refuses remote paths and incorrectly pinned backups before restoration',()=>{
  for(const path of ['https://example.com/backup','file:///tmp/a','\\\\server\\share','//server/share']) assert.throws(()=>localPath(path));
  assert.equal(localPath('node_modules/.cloudflare-test/fixture.json'),'node_modules/.cloudflare-test/fixture.json');
  const envelope={payload:'{}',sha256:createHash('sha256').update('{}').digest('hex')};
  assert.throws(()=>validate(envelope,{...expected}),/PINNED_BACKUP_HASH_MISMATCH/);
  const backup={format:'ABC_DO_BACKUP_V1',identity:expected.identity,bookmark:expected.bookmark};
  const receipt={objectId:expected.identity,namespace:expected.namespace,bookmark:expected.bookmark,exportBookmark:expected.bookmark};
  assert.doesNotThrow(()=>validateMetadata(backup,receipt));
  for(const key of ['objectId','namespace','bookmark','exportBookmark']) assert.throws(()=>validateMetadata(backup,{...receipt,[key]:'wrong'}),/PINNED_RECOVERY_IDENTITY_MISMATCH/);
  assert.throws(()=>validateMetadata({...backup,identity:'wrong'},receipt),/PINNED_RECOVERY_IDENTITY_MISMATCH/);
});

test('isolated restore preserves exact SQL and KV, refuses nonempty targets and mismatched ledger',async()=>{
  const fixture=await build({entryPoints:['cloudflare/maintenance/test-fixture.mjs'],outfile:'node_modules/.cloudflare-test/recovery-seed.mjs',bundle:true,format:'esm',platform:'neutral',external:['node:*']});
  const mf=new Miniflare({modules:true,scriptPath:'node_modules/.cloudflare-test/recovery-seed.mjs',compatibilityDate:'2025-10-11',compatibilityFlags:['nodejs_compat'],durableObjects:{SALON_DB:{className:'Fixture',useSQLite:true}},bindings:{MAINTENANCE_TOKEN:'a'.repeat(64)},outboundService:()=>new Response('DENIED',{status:403})});
  let backup;
  try {
    const ns=await mf.getDurableObjectNamespace('SALON_DB');
    const source=ns.get(ns.idFromName('synthetic-source'));
    await source.fetch('https://local/seed');
    backup=await (await source.fetch('https://local/snapshot')).json();
    const target=ns.get(ns.idFromName('synthetic-target'));
    assert.equal((await target.fetch('https://local/restore',{method:'POST',body:JSON.stringify(backup)})).status,200);
    await assert.rejects(target.fetch('https://local/restore',{method:'POST',body:JSON.stringify(backup)}));
  } finally {await mf.dispose();}
  // The synthetic ExportEdge table intentionally differs from the candidate schema.
  await assert.rejects(rehearse({payload:JSON.stringify(backup)}),/UPGRADED_SCHEMA_MISMATCH/);
  backup.schema=backup.schema.filter(s=>s.name!=='ExportEdge');
  backup.tables=backup.tables.filter(t=>t.name!=='ExportEdge');
  const result=await rehearse({payload:JSON.stringify(backup)});
  assert.equal(result.allTablesExact,true); assert.equal(result.candidateSchemaMatch,true);
  assert.equal(result.kvExact,true); assert.equal(result.remoteAccessEnabled,false);
  const ledger=backup.tables.find(t=>t.name==='_Migrations');
  ledger.rows[0][ledger.columns.indexOf('checksum')]=['text','wrong'];
  await assert.rejects(rehearse({payload:JSON.stringify(backup)}),/LOCAL_RESTORE_FAILED/);
});

test('recovery harness requires local guard; deployment bundles exclude recovery code',async()=>{
  const mf=new Miniflare({modules:true,scriptPath:'node_modules/.cloudflare-test/local-recovery.mjs',compatibilityDate:'2025-10-11',durableObjects:{LOCAL:{className:'DisposableRecovery',useSQLite:true}}});
  try {assert.equal((await mf.dispatchFetch('https://local-recovery.invalid/restore')).status,403);} finally {await mf.dispose();}
  const result=await build({entryPoints:['cloudflare/maintenance/worker.mjs'],bundle:true,write:false,format:'esm',platform:'neutral',external:['node:*'],metafile:true});
  assert(!Object.keys(result.metafile.inputs).some(p=>/local-recovery|local-rehearsal|rehearse-staging-recovery/.test(p)));
  const appMap=JSON.parse(await readFile('cloudflare/.build/worker.mjs.map','utf8'));
  assert(!appMap.sources.some(p=>/local-recovery|local-rehearsal/.test(p)));
  const runner=await readFile('scripts/rehearse-staging-recovery.mjs','utf8');
  assert(!/remoteProxy|wrangler\.json|process\.env|persist\s*:/.test(runner));
  const wrapper=await readFile('scripts/Test-StagingRecovery.ps1','utf8');
  assert(!/Invoke-WebRequest|Invoke-RestMethod|wrangler |secret put/i.test(wrapper));
});
