// Staging only. Default is a SELECT/PRAGMA preflight; --apply only fills NULLs.
// Schema/ledger changes and deployments are deliberately outside this command.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const account = 'b57cd96d4a71d1b21f38db1b04f4dea8';
const namespace = '2fdf4c973d96486bbf32c610f9a2cd89';
const script = 'hair-salon-backend-staging';
const object = 'salon-v1';
const objectId = '653265811d09a8559c5bb0480a4248e5e386e370731de8ce18100de56d2b5f4a';
const apply = process.argv.includes('--apply');
let token = process.env.CLOUDFLARE_API_TOKEN;
if (!token) {
  let credentials;
  try { credentials = JSON.parse(execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','auth','token','--json'],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']})); }
  catch { throw new Error('Cloudflare authentication unavailable'); }
  token = credentials.token ?? credentials.api_token ?? credentials.oauth_token;
}
if (!token) throw new Error('Cloudflare authentication unavailable');
const base = `https://api.cloudflare.com/client/v4/accounts/${account}/workers/durable_objects/namespaces`;
const request = async (url, options={}) => {
  const response=await fetch(url,{...options,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'}});
  const body=await response.json();
  if(!response.ok||!body.success)throw new Error(`Cloudflare request failed (${response.status})`);
  return body.result;
};
const namespaces = await request(base);
if(!namespaces.some(item=>item.id===namespace&&item.script===script&&item.class==='SalonDatabase'&&item.use_sqlite))throw new Error('Staging namespace identity mismatch');
const query = async statements => {
  const result=await request(`${base}/${namespace}/query`,{method:'POST',body:JSON.stringify({durable_object_id:objectId,queries:statements.map(sql=>({sql}))})});
  return result.results.map(entry=>({rows:entry.rows.map(row=>Object.fromEntries(entry.columns.map((name,index)=>[name,row[index]]))),meta:entry.meta}));
};
const [brands, columns, ledger, stats] = await query(['SELECT id,name FROM Brand ORDER BY id','PRAGMA table_info(Branch)','SELECT version,checksum FROM _Migrations ORDER BY version','SELECT COUNT(*) AS count FROM Branch']);
const { default: expected } = await import('../cloudflare/.build/migrations.mjs');
for(let index=0;index<ledger.rows.length;index++) {
  if(ledger.rows[index].version!==expected[index]?.version||ledger.rows[index].checksum!==expected[index]?.checksum)throw new Error('Live migration ledger differs from the prepared artifact; stop before applying changes');
}
const version=ledger.rows.at(-1)?.version??0;
const column=columns.rows.find(row=>row.name==='brandId');
if(!column){console.log(JSON.stringify({environment:'staging',object,schemaReady:false,migrationVersion:version,migrationChecksumsMatch:true,branchCount:stats.rows[0].count,brands:brands.rows,reason:'Apply the prepared v42 Worker migration before backfilling; no writes performed'}));process.exitCode=1;}
else {
  if(apply&&version<42)throw new Error('Apply the prepared v42 Worker migration before changing ownership');
  const [before]=await query(['SELECT * FROM Branch ORDER BY id']);
  const nullBefore=before.rows.filter(row=>row.brandId===null).length;
  if(apply&&brands.rows.length!==1&&nullBefore)throw new Error('Ownership is ambiguous: an explicit Branch-to-Brand mapping is required');
  const preserve = rows => createHash('sha256').update(JSON.stringify(rows.map(({brandId,...row})=>row))).digest('hex');
  let written=0;
  if(apply&&nullBefore){
    const [updated]=await query(['UPDATE Branch SET brandId=(SELECT id FROM Brand) WHERE brandId IS NULL AND (SELECT COUNT(*) FROM Brand)=1 RETURNING id,brandId']);
    written=updated.rows.length;
  }
  const [after, invalid]=await query(['SELECT * FROM Branch ORDER BY id','SELECT COUNT(*) AS count FROM Branch AS b LEFT JOIN Brand AS r ON r.id=b.brandId WHERE b.brandId IS NOT NULL AND r.id IS NULL']);
  const nullAfter=after.rows.filter(row=>row.brandId===null).length;
  if(apply){
    if(preserve(before.rows)!==preserve(after.rows))throw new Error('Other Branch fields changed during the operation; inspect concurrent changes');
    for(const row of before.rows.filter(row=>row.brandId!==null))if(after.rows.find(item=>item.id===row.id)?.brandId!==row.brandId)throw new Error('An existing ownership changed concurrently');
    if(nullAfter||invalid.rows[0].count)throw new Error('Backfill verification failed; nullable ownership remains');
  }
  console.log(JSON.stringify({environment:'staging',mode:apply?'apply-null-only':'read-only',migrationVersion:version,migrationChecksumsMatch:true,brandIdNullable:column.notnull===0,brands:brands.rows,branchCount:after.rows.length,nullBefore,nullAfter,invalidOwners:invalid.rows[0].count,rowsAssigned:written}));
}
