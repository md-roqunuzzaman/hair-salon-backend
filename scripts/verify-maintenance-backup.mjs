// Accepts a LOCAL file only. No Cloudflare credentials, deployment or remote bindings.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { spawnSync } from 'node:child_process';
const file=process.argv[2];
if(!file||/^https?:/i.test(file))throw Error('Usage: node scripts/verify-maintenance-backup.mjs <local-backup.json>');
const envelope=JSON.parse(await readFile(file,'utf8'));
if(typeof envelope.payload!=='string'||createHash('sha256').update(envelope.payload).digest('hex')!==envelope.sha256)throw Error('BACKUP_HASH_MISMATCH');
const backup=JSON.parse(envelope.payload);
if(backup.format!=='ABC_DO_BACKUP_V1'||!backup.identity||!backup.bookmark)throw Error('INVALID_BACKUP');
const physical=spawnSync('python',['scripts/check-maintenance-sqlite.py',file],{encoding:'utf8'});
if(physical.status!==0)throw Error('LOCAL_SQLITE_INTEGRITY_CHECK_FAILED_OR_PYTHON_UNAVAILABLE');
await build({entryPoints:['cloudflare/maintenance/local-rehearsal.mjs'],outfile:'node_modules/.cloudflare-test/maintenance-rehearsal.mjs',bundle:true,format:'esm',platform:'neutral'});
const mf=new Miniflare({modules:true,scriptPath:'node_modules/.cloudflare-test/maintenance-rehearsal.mjs',compatibilityDate:'2025-10-11',durableObjects:{LOCAL:{className:'LocalRehearsal',useSQLite:true}},bindings:{BACKUP:envelope.payload}});
try {
  const response=await mf.dispatchFetch('https://local-only/');
  const result=await response.json();
  if(!response.ok)throw Error('LOCAL_REHEARSAL_FAILED: review ledger, mappings and backup schema without logging row data');
  console.log(JSON.stringify({sha256:envelope.sha256,...result}));
}finally{await mf.dispose();}
