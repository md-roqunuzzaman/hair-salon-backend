// LOCAL TEST HARNESS ONLY. No deployment configuration imports this module.
import { restoreLocal, verifyPreservation } from './local-rehearsal.mjs';
import { sqlSnapshot, quote } from './snapshot.mjs';
import { pack } from './codec.mjs';
import { applyMigrations } from '../runtime/migrations.mjs';
import migrations from '../.build/migrations.mjs';
const assert = (ok, message) => { if (!ok) throw Error(message); };
const digest = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value))))].map(b=>b.toString(16).padStart(2,'0')).join('');
export function checkLedger(snapshot) {
  const t = snapshot.tables.find(t=>t.name==='_Migrations');
  assert(t?.rows.length, 'MISSING_LEDGER');
  const versionIndex=t.columns.indexOf('version'), checksumIndex=t.columns.indexOf('checksum');
  for (const [i,row] of t.rows.entries()) assert(Number(row[versionIndex][1])===migrations[i]?.version && row[checksumIndex][1]===migrations[i]?.checksum, 'LEDGER_MISMATCH');
  return t.rows.length;
}
function schema(storage) {
  const sort = rows => rows.map(row=>JSON.stringify(row)).sort();
  return storage.sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE '__cf_%' AND name NOT IN ('_Migrations','_Sessions') ORDER BY name").toArray().map(({name})=>({
    name,
    columns:sort(storage.sql.exec(`PRAGMA table_info(${quote(name)})`).toArray().map(({cid,...r})=>r)),
    foreignKeys:sort(storage.sql.exec(`PRAGMA foreign_key_list(${quote(name)})`).toArray().map(({id,...r})=>r)),
    indexes:sort(storage.sql.exec(`PRAGMA index_list(${quote(name)})`).toArray().map(({seq,...r})=>({...r,columns:storage.sql.exec(`PRAGMA index_info(${quote(r.name)})`).toArray().map(({cid,...c})=>c)}))),
  }));
}
export class DisposableRecovery {
  constructor(ctx,env) { this.ctx=ctx; this.env=env; }
  async fetch(request) {
    if(this.env.LOCAL_RECOVERY_ONLY !== 'DISPOSABLE_NO_REMOTE') return new Response('LOCAL_GUARD_REQUIRED',{status:403});
    try {
      if(new URL(request.url).pathname==='/reference') {
        applyMigrations(this.ctx.storage,migrations);
        return Response.json({schema:await digest(schema(this.ctx.storage))});
      }
      const backup=JSON.parse(this.env.BACKUP);
      checkLedger(backup);
      await restoreLocal(this.ctx.storage,backup);
      const restored=sqlSnapshot(this.ctx.storage);
      const checks=[];
      for(const table of restored.tables) {
        const original=backup.tables.find(t=>t.name===table.name);
        assert(await digest(table)===await digest(original),'TABLE_DIGEST_MISMATCH');
        checks.push({table:table.name,rows:table.rows.length,sha256:await digest(table),exactMatch:true});
      }
      const originalVersion=checkLedger(restored);
      applyMigrations(this.ctx.storage,migrations);
      const upgraded=sqlSnapshot(this.ctx.storage);
      const preservedCells=verifyPreservation(restored,upgraded);
      assert(checkLedger(upgraded)===migrations.length,'INCOMPLETE_UPGRADE');
      assert(this.ctx.storage.sql.exec('PRAGMA foreign_key_check').toArray().length===0,'FOREIGN_KEYS_FAILED');
      applyMigrations(this.ctx.storage,migrations);
      assert(JSON.stringify(upgraded)===JSON.stringify(sqlSnapshot(this.ctx.storage)),'REPEAT_CHANGED_STATE');
      assert(JSON.stringify([...(await this.ctx.storage.list())].map(([k,v])=>[k,pack(v)]))===JSON.stringify(backup.kv),'KV_CHANGED');
      return Response.json({restored:true,allTablesExact:true,kvExact:true,originalVersion,upgradedVersion:migrations.at(-1).version,preservedCells,repeatable:true,schema:await digest(schema(this.ctx.storage)),tables:checks});
    } catch { return Response.json({error:'LOCAL_RECOVERY_VALIDATION_FAILED'},{status:409}); }
  }
}
export default {fetch(request,env) {
  const url=new URL(request.url);
  if(env.LOCAL_RECOVERY_ONLY!=='DISPOSABLE_NO_REMOTE'||url.hostname!=='local-recovery.invalid'||!['/restore','/reference'].includes(url.pathname)) return new Response('LOCAL_ONLY',{status:403});
  const name=url.pathname==='/reference'?'empty-reference':'disposable-restore';
  return env.LOCAL.get(env.LOCAL.idFromName(name)).fetch(request);
}};
