import worker,{SalonDatabase} from './worker.mjs';
import { capture } from './snapshot.mjs';
import { pack } from './codec.mjs';
import { applyMigrations } from '../runtime/migrations.mjs';
import migrations from '../.build/migrations.mjs';
import { restoreLocal } from './local-rehearsal.mjs';
export class Fixture extends SalonDatabase {
  async fetch(request) {
    const path=new URL(request.url).pathname;
    if(path==='/seed') {
      applyMigrations(this.ctx.storage,migrations.slice(0,10));
      this.ctx.storage.sql.exec("INSERT INTO User(id,name,email,passwordHash,updatedAt) VALUES ('test-user','Synthetic','local@example.invalid','hash',1)");
      this.ctx.storage.sql.exec("INSERT INTO Wallet(id,customerId,paidBalance,bonusBalance,updatedAt) VALUES ('test-wallet','test-user',12345,678,1)");
      this.ctx.storage.sql.exec('CREATE TABLE ExportEdge (id TEXT PRIMARY KEY, exact INTEGER, bin BLOB, nullable TEXT)');
      this.ctx.storage.sql.exec("INSERT INTO ExportEdge VALUES ('edge',CAST('9223372036854775807' AS INTEGER),?,NULL)",new Uint8Array([0,128,255]).buffer);
      await this.ctx.storage.put('seeded',true);
      await this.ctx.storage.put('edge',{date:new Date('2026-01-01T00:00:00Z'),big:12n,bytes:new Uint8Array([1,2]).buffer});
      return new Response('seeded');
    }
    if(path==='/empty') return Response.json({tables:this.ctx.storage.sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '_cf_%' AND name NOT LIKE '__cf_%' AND name NOT LIKE 'sqlite_%'").toArray().length,kv:(await this.ctx.storage.list()).size});
    if(path==='/snapshot') {
      const storage=this.ctx.storage;
      // PITR is unsupported locally; simulate only bookmark consistency, never production fallback.
      const fake={sql:storage.sql,transactionSync:fn=>storage.transactionSync(fn),list:opts=>storage.list(opts),getCurrentBookmark:async()=> 'LOCAL_SYNTHETIC_BOOKMARK'};
      const before=await capture(fake,this.ctx.id.toString());
      return Response.json(before);
    }
    if(path==='/restore') {
      const backup=await request.json();await restoreLocal(this.ctx.storage,backup);return Response.json({restored:true});
    }
    if(path==='/kv') return Response.json([...(await this.ctx.storage.list())].map(([k,v])=>[k,pack(v)]));
    return super.fetch(request);
  }
}
export default worker;
