// Local files + ephemeral Miniflare only. No Wrangler, credentials or remote bindings.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { isAbsolute } from 'node:path';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
export const expected = Object.freeze({sha256:'8e25420ca9fb9c47280a9b554b42b6fb3821a451a00fe444a3ad087776585842',identity:'653265811d09a8559c5bb0480a4248e5e386e370731de8ce18100de56d2b5f4a',namespace:'2fdf4c973d96486bbf32c610f9a2cd89',bookmark:'00000135-00000000-0000510c-8d4eec0147344b50501ac7e8a6fb0649'});
export function localPath(file) {
  if(!file||/^[/\\]{2}|^[a-z][a-z\d+.-]*:\/\//i.test(file)||(!isAbsolute(file)&&file.includes(':'))) throw Error('LOCAL_PATH_REQUIRED');
  return file;
}
export function validate(envelope,receipt) {
  const hash=createHash('sha256').update(envelope.payload).digest('hex');
  if(hash!==envelope.sha256||hash!==expected.sha256||receipt.sha256!==hash)throw Error('PINNED_BACKUP_HASH_MISMATCH');
  const backup=JSON.parse(envelope.payload);
  validateMetadata(backup,receipt);
  return backup;
}
export function validateMetadata(backup,receipt) {
  if(backup.format!=='ABC_DO_BACKUP_V1'||backup.identity!==expected.identity||receipt.objectId!==expected.identity||receipt.namespace!==expected.namespace||backup.bookmark!==expected.bookmark||receipt.bookmark!==expected.bookmark||receipt.exportBookmark!==expected.bookmark)throw Error('PINNED_RECOVERY_IDENTITY_MISMATCH');
}
export async function rehearse(envelope) {
  await build({entryPoints:['cloudflare/maintenance/local-recovery.mjs'],outfile:'node_modules/.cloudflare-test/local-recovery.mjs',bundle:true,format:'esm',platform:'neutral'});
  const mf=new Miniflare({host:'127.0.0.1',modules:true,scriptPath:'node_modules/.cloudflare-test/local-recovery.mjs',compatibilityDate:'2025-10-11',durableObjects:{LOCAL:{className:'DisposableRecovery',useSQLite:true}},bindings:{LOCAL_RECOVERY_ONLY:'DISPOSABLE_NO_REMOTE',BACKUP:envelope.payload},outboundService:()=>new Response('OUTBOUND_DISABLED',{status:403})});
  try {
    const restored=await mf.dispatchFetch('https://local-recovery.invalid/restore');
    if(!restored.ok)throw Error('LOCAL_RESTORE_FAILED');
    const result=await restored.json();
    const reference=await (await mf.dispatchFetch('https://local-recovery.invalid/reference')).json();
    if(result.schema!==reference.schema)throw Error('UPGRADED_SCHEMA_MISMATCH');
    return {...result,candidateSchemaMatch:true,remoteAccessEnabled:false};
  } finally {await mf.dispose();}
}
async function main() {
  const [file,receiptFile,reportFile,...extra]=process.argv.slice(2);
  if(extra.length)throw Error('UNEXPECTED_ARGUMENT');
  [file,receiptFile,reportFile].forEach(localPath);
  const envelope=JSON.parse(await readFile(file,'utf8'));
  validate(envelope,JSON.parse((await readFile(receiptFile,'utf8')).replace(/^\uFEFF/,'')));
  const physical=spawnSync('python',['scripts/check-maintenance-sqlite.py',file],{encoding:'utf8',windowsHide:true});
  if(physical.status!==0)throw Error('SQLITE_INTEGRITY_CHECK_FAILED');
  const result={sha256:envelope.sha256,sqliteIntegrity:true,...await rehearse(envelope)};
  await writeFile(reportFile,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({restored:result.restored,sqliteIntegrity:true,allTablesExact:result.allTablesExact,tables:result.tables.length,originalVersion:result.originalVersion,upgradedVersion:result.upgradedVersion,preservedCells:result.preservedCells,candidateSchemaMatch:true,remoteAccessEnabled:false}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{console.error('LOCAL_RECOVERY_FAILED: inspect protected inputs and local prerequisites; no remote operation attempted');process.exitCode=1;});
