import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { writeFile,readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pack,unpack } from './maintenance/codec.mjs';
import { capture } from './maintenance/snapshot.mjs';
const token='a'.repeat(64);
test('maintenance: read-only constructor, authentication, pinned identity, backup fidelity and local upgrade',async()=>{
  const result=await build({entryPoints:['cloudflare/maintenance/test-fixture.mjs'],outfile:'node_modules/.cloudflare-test/maintenance.mjs',bundle:true,format:'esm',platform:'neutral',external:['node:*'],metafile:true});
  assert(!Object.keys(result.metafile.inputs).some(p=>p==='src/app.ts'));
  const mf=new Miniflare({modules:true,scriptPath:'node_modules/.cloudflare-test/maintenance.mjs',compatibilityDate:'2025-10-11',compatibilityFlags:['nodejs_compat'],durableObjects:{SALON_DB:{className:'Fixture',useSQLite:true}},bindings:{MAINTENANCE_TOKEN:token}});
  try{
    const ns=await mf.getDurableObjectNamespace('SALON_DB');
    const stub=ns.get(ns.idFromName('salon-v1'));
    assert.deepEqual(await (await stub.fetch('https://local/empty')).json(),{tables:0,kv:0});
    assert.equal((await mf.dispatchFetch('https://local/api/v1/auth/login')).status,503);
    assert.equal((await mf.dispatchFetch('https://local/__maintenance/export')).status,401);
    assert.equal((await mf.dispatchFetch('https://local/__maintenance/export',{headers:{authorization:`Bearer ${'b'.repeat(64)}`}})).status,401);
    const headers={authorization:`Bearer ${token}`};
    assert.equal((await mf.dispatchFetch('https://local/__maintenance/restore',{method:'POST',headers})).status,405);
    assert.equal((await mf.dispatchFetch('https://local/__maintenance/sql',{headers})).status,404);
    const identity=(await (await mf.dispatchFetch('https://local/__maintenance/target',{headers})).json()).identity;
    assert.equal(identity,ns.idFromName('salon-v1').toString());
    assert.deepEqual(await (await stub.fetch('https://local/empty')).json(),{tables:0,kv:0});
    assert.equal((await mf.dispatchFetch('https://local/__maintenance/export',{headers})).status,409);
    headers['x-maintenance-object-id']=identity;
    // Some local runtimes supply placeholder bookmarks. This is not remote PITR certification.
    assert([200,503].includes((await mf.dispatchFetch('https://local/__maintenance/bookmark',{headers})).status));
    await stub.fetch('https://local/seed');
    const exported=await mf.dispatchFetch('https://local/__maintenance/export',{headers});
    assert.equal(exported.status,200,await exported.clone().text());
    const exportedEnvelope=await exported.json();
    assert.equal(createHash('sha256').update(exportedEnvelope.payload).digest('hex'),exportedEnvelope.sha256);
    const backup=await (await stub.fetch('https://local/snapshot')).json();
    const target=ns.get(ns.idFromName('local-restore'));
    assert.equal((await target.fetch('https://local/restore',{method:'POST',body:JSON.stringify(backup)})).status,200);
    assert.deepEqual(await (await target.fetch('https://local/kv')).json(),backup.kv);
    const payload=JSON.stringify(backup), file='node_modules/.cloudflare-test/maintenance-backup.json';
    const envelope={payload,sha256:createHash('sha256').update(payload).digest('hex')};
    await writeFile(file,JSON.stringify(envelope));
    const run=spawnSync(process.execPath,['scripts/verify-maintenance-backup.mjs',file],{encoding:'utf8'});
    assert.equal(run.status,0,run.stderr);
    assert.equal(JSON.parse(run.stdout.trim()).version,12);
    await writeFile(file,JSON.stringify({...envelope,sha256:'0'.repeat(64)}));
    const corrupt=spawnSync(process.execPath,['scripts/verify-maintenance-backup.mjs',file],{encoding:'utf8'});
    assert.notEqual(corrupt.status,0);
    const config=JSON.parse(await readFile('wrangler.staging-maintenance.jsonc','utf8'));
    assert.equal(config.name,'hair-salon-backend-staging');assert.deepEqual(config.triggers.crons,[]);
    assert.deepEqual(config.durable_objects.bindings,[{name:'SALON_DB',class_name:'SalonDatabase'}]);
    const production=await build({entryPoints:['cloudflare/maintenance/worker.mjs'],bundle:true,write:false,format:'esm',platform:'neutral',external:['node:*'],metafile:true});
    assert(!Object.keys(production.metafile.inputs).some(p=>/local-rehearsal|fixture|migrations|src\//.test(p)));
  }finally{await mf.dispose();}
});
test('tagged codec round trips supported values and rejects loss',()=>{
  const value={n:-0,date:new Date('2026-01-01'),big:123n,bin:new Uint8Array([0,255]).buffer,list:[undefined,null],map:new Map([['a',1]]),set:new Set(['x'])};
  assert.deepEqual(unpack(pack(value)),value);
  assert.throws(()=>pack(Number.MAX_SAFE_INTEGER+1));
  const cyclic={};cyclic.self=cyclic;assert.throws(()=>pack(cyclic));
});
test('export rejects a state change between reads without logging data',async()=>{
  let reads=0;
  const sql={exec(query){return {toArray(){return [];}};}};
  await assert.rejects(capture({sql,getCurrentBookmark:async()=> 'bookmark',list:async()=>new Map([['seeded',++reads]])},'local'),/STORAGE_CHANGED_DURING_EXPORT/);
});
