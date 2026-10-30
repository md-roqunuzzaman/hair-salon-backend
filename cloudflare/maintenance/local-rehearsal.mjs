// LOCAL HARNESS ONLY. Never referenced by either deployment configuration.
import { sqlSnapshot, quote } from './snapshot.mjs';
import { pack, unpack } from './codec.mjs';
import { applyMigrations } from '../runtime/migrations.mjs';
import migrations from '../.build/migrations.mjs';
import { policyTimeMinutes } from '../../src/app/module/cancellation-refund/policy-time.ts';
const assert=(ok,message)=>{if(!ok)throw Error(message);};
export async function restoreLocal(storage,backup) {
  assert(storage.sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE '__cf_%'").toArray().length===0,'TARGET_NOT_EMPTY');
  assert((await storage.list()).size===0,'KV_TARGET_NOT_EMPTY');
  storage.transactionSync(()=>{
    storage.sql.exec('PRAGMA defer_foreign_keys = ON');
    for(const s of backup.schema.filter(s=>s.type==='table')) storage.sql.exec(s.sql);
    for(const table of backup.tables) for(const row of table.rows) {
      assert(row.length===table.columns.length,'INVALID_ROW');
      const placeholders=row.map(([type])=>type==='integer'?'CAST(? AS INTEGER)':'?');
      storage.sql.exec(`INSERT INTO ${quote(table.name)} (${table.columns.map(quote)}) VALUES (${placeholders})`,...row.map(([,v])=>unpack(v)));
    }
    for(const s of backup.schema.filter(s=>s.type!=='table')) storage.sql.exec(s.sql);
    assert(storage.sql.exec('PRAGMA foreign_key_check').toArray().length===0,'FOREIGN_KEYS_FAILED');
  });
  for(const [key,value] of backup.kv) await storage.put(key,unpack(value));
  assert(JSON.stringify(sqlSnapshot(storage))===JSON.stringify({schema:backup.schema,tables:backup.tables}),'SQL_RESTORE_MISMATCH');
  const kv=[...(await storage.list())].map(([key,v])=>[key,pack(v)]);
  assert(JSON.stringify(kv)===JSON.stringify(backup.kv),'KV_RESTORE_MISMATCH');
}
export function verifyPreservation(before,after) {
  let checked=0;
  for(const old of before.tables) {
    const next=after.tables.find(t=>t.name===old.name);
    assert(next,'TABLE_REMOVED');
    if(old.name==='_Migrations') continue;
    assert(next.rows.length===old.rows.length,'ROW_COUNT_CHANGED');
    // Compare all pre-upgrade rows/columns. Only explicit historical migrations' transformations are allowed.
    for(let i=0;i<old.rows.length;i++) for(let c=0;c<old.columns.length;c++) {
      const name=old.columns[c], cell=old.rows[i][c];
      const minuteColumns={BranchBookingPolicy:{cancellationCutoffHours:'cancellationCutoffMinutes',rescheduleCutoffHours:'rescheduleCutoffMinutes'},BranchCancellationPolicy:{minimumCancellationHours:'minimumCancellationMinutes'},GroupPurchaseCancellationPolicy:{minimumCancellationHours:'minimumCancellationMinutes',restorationMinimumHours:'restorationMinimumMinutes'}};
      const minuteColumn=minuteColumns[old.name]?.[name];
      if(minuteColumn&&!next.columns.includes(name)){
        const target=next.rows[i][next.columns.indexOf(minuteColumn)];
        assert(target&&target[0]==='integer'&&BigInt(unpack(target[1]))===BigInt(unpack(cell[1]))*60n,'POLICY_MINUTE_CONVERSION_CHANGED');checked++;continue;
      }
      if(['BranchCancellationPolicy','GroupPurchaseRefundPolicy'].includes(old.name)&&name==='refundTiers'){
        const actual=JSON.parse(unpack(next.rows[i][next.columns.indexOf(name)][1]));
        const expected=policyTimeMinutes(JSON.parse(unpack(cell[1])));
        const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort().map(([k,v])=>[k,canonical(v)])):value;
        assert(JSON.stringify(canonical(actual))===JSON.stringify(canonical(expected)),'POLICY_TIER_CONVERSION_CHANGED');checked++;continue;
      }
      if(['GroupPurchaseRefundPolicy','GroupPurchaseCancellationPolicy'].includes(old.name)&&name==='packageId'&&!next.columns.includes(name)) {
        assert(unpack(cell[1])==='9ff78b23-f681-4007-a44c-ef4277decf17','UNAPPROVED_MAPPING');
        assert(unpack(next.rows[i][next.columns.indexOf('branchId')][1])==='f7318524-db7c-49cf-8bc4-bfc6ff5c6b97','MAPPING_CHANGED');
        continue;
      }
      if(old.name==='GroupPurchaseCancellationPolicy'&&name==='forfeitOnLateCancellation'&&!next.columns.includes(name)) {
        assert(unpack(next.rows[i][next.columns.indexOf('lateCancellationOutcome')][1])===(unpack(cell[1])==='1'?'FORFEITED':'RESTORED'),'OUTCOME_CHANGED');continue;
      }
      const n=next.columns.indexOf(name);assert(n>=0,'COLUMN_REMOVED');
      let expected=cell;
      if(old.name==='GroupPurchase'&&name==='purchaseFlow'&&unpack(cell[1])==='BUY_NOW_BOOK_NOW')expected=['text','DIRECT_BOOK'];
      assert(JSON.stringify(next.rows[i][n])===JSON.stringify(expected),'EXISTING_VALUE_CHANGED');checked++;
    }
  }
  return checked;
}
export class LocalRehearsal {
  constructor(ctx,env){this.ctx=ctx;this.env=env;}
  async fetch() {
    try {
      const backup=JSON.parse(this.env.BACKUP);
      await restoreLocal(this.ctx.storage,backup);
      const before=sqlSnapshot(this.ctx.storage);
      applyMigrations(this.ctx.storage,migrations);
      const after=sqlSnapshot(this.ctx.storage);
      const checked=verifyPreservation(before,after);
      applyMigrations(this.ctx.storage,migrations);
      assert(JSON.stringify(after)===JSON.stringify(sqlSnapshot(this.ctx.storage)),'REPEAT_CHANGED_DATABASE');
      assert(JSON.stringify([...(await this.ctx.storage.list())].map(([k,v])=>[k,pack(v)]))===JSON.stringify(backup.kv),'KV_CHANGED');
      return Response.json({restored:true,migrated:true,repeatable:true,preservedCells:checked,version:migrations.at(-1).version});
    }catch(error){return Response.json({error:error.message}, {status:409});}
  }
}
export default {fetch(request,env){return env.LOCAL.get(env.LOCAL.idFromName('disposable-rehearsal')).fetch(request);}};
