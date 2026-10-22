// Local verification of authenticated captures; never contacts Cloudflare.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { verifyPreservation } from '../cloudflare/maintenance/local-rehearsal.mjs';
import { expected, rehearse } from './rehearse-staging-recovery.mjs';
import migrations from '../cloudflare/.build/migrations.mjs';
const dir='.maintenance-backups/staging-pre-upgrade/';
const read=async name=>{
  const envelope=JSON.parse(await readFile(dir+name,'utf8'));
  assert.equal(createHash('sha256').update(envelope.payload).digest('hex'),envelope.sha256,'CAPTURE_HASH_MISMATCH');
  const data=JSON.parse(envelope.payload);
  assert.equal(data.identity,expected.identity,'OBJECT_ID_MISMATCH');
  return {envelope,data};
};
try {
  const mode=process.argv[2];
  assert(['before','after'].includes(mode),'MODE_REQUIRED');
  const original=await read('staging-envelope.json');
  assert.equal(original.envelope.sha256,expected.sha256,'BACKUP_PIN_MISMATCH');
  const current=await read(mode==='before'?'pre-deploy-current-envelope.json':'post-migration-envelope.json');
  let result;
  if(mode==='before') {
    for(const key of ['schema','tables','kv'])assert.deepEqual(current.data[key],original.data[key],'LIVE_DATABASE_CHANGED');
    result={unchangedSinceBackup:true,tables:current.data.tables.length,kv:current.data.kv.length};
  } else {
    const ledger=current.data.tables.find(t=>t.name==='_Migrations');
    assert.equal(ledger.rows.length,migrations.length,'INCOMPLETE_MIGRATION');
    for(const [i,row] of ledger.rows.entries()) {
      assert.equal(Number(row[ledger.columns.indexOf('version')][1]),migrations[i].version,'VERSION_MISMATCH');
      assert.equal(row[ledger.columns.indexOf('checksum')][1],migrations[i].checksum,'CHECKSUM_MISMATCH');
    }
    const preservedCells=verifyPreservation(original.data,current.data);
    assert.deepEqual(current.data.kv,original.data.kv,'KV_CHANGED');
    const rehearsal=await rehearse(current.envelope);
    result={migrationVersion:migrations.at(-1).version,allChecksumsMatch:true,preservedCells,allOldRowsPreserved:true,kvPreserved:true,schemaCompatible:rehearsal.candidateSchemaMatch,financialDataPreserved:true};
  }
  await writeFile(dir+`${mode}-deployment-comparison.json`,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify(result));
} catch {
  console.error('STAGING_CAPTURE_VERIFICATION_FAILED: stop; inspect protected captures locally; no rollback or restore attempted');
  process.exitCode=1;
}
