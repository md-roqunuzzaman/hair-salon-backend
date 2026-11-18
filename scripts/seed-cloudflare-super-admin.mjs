// Staging only. Passwords/hashes remain in memory; default mode never writes.
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { superAdminSettings, seedCloudflareSuperAdmin } from './lib/cloudflare-super-admin.mjs';
import migrations from '../cloudflare/.build/migrations.mjs';

const settings=superAdminSettings(process.env);
const apply=process.argv.includes('--apply');
const account='b57cd96d4a71d1b21f38db1b04f4dea8';
const namespace='2fdf4c973d96486bbf32c610f9a2cd89';
const object='653265811d09a8559c5bb0480a4248e5e386e370731de8ce18100de56d2b5f4a';
let token=process.env.CLOUDFLARE_API_TOKEN;
if(!token){
  let auth;
  try{auth=JSON.parse(execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','auth','token','--json'],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}));}
  catch{throw new Error('Cloudflare authentication unavailable');}
  token=auth.token??auth.api_token??auth.oauth_token;
}
if(!token)throw new Error('Cloudflare authentication unavailable');
const request=async(url,options={})=>{
  const response=await fetch(url,{...options,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},signal:AbortSignal.timeout(30000)});
  const body=await response.json();
  if(!response.ok||!body.success)throw new Error(`Cloudflare request failed (${response.status})`);
  return body.result;
};
const base=`https://api.cloudflare.com/client/v4/accounts/${account}/workers/durable_objects/namespaces`;
const namespaces=await request(base);
if(!namespaces.some(item=>item.id===namespace&&item.script==='hair-salon-backend-staging'&&item.class==='SalonDatabase'&&item.use_sqlite))throw new Error('Staging namespace identity mismatch');
const query=async(sql,params=[])=>{
  const data=await request(`${base}/${namespace}/query`,{method:'POST',body:JSON.stringify({durable_object_id:object,queries:[{sql,params}]})});
  const entry=data.results?.[0];
  if(!Array.isArray(entry?.columns)||!Array.isArray(entry?.rows))throw new Error('Cloudflare SQL result unavailable');
  return entry.rows.map(row=>Object.fromEntries(entry.columns.map((name,index)=>[name,row[index]])));
};
const ledger=await query('SELECT version,checksum FROM _Migrations ORDER BY version');
for(let index=0;index<ledger.length;index++)if(ledger[index].version!==migrations[index]?.version||ledger[index].checksum!==migrations[index]?.checksum)throw new Error('Staging migration history differs from the prepared build');
const version=ledger.at(-1)?.version??0;
const ready=version>=43;
if(apply&&!ready)throw new Error('Staging v43 is not deployed; deploy the prepared Worker before creating SUPER_ADMIN');
const accountResult=await seedCloudflareSuperAdmin({query,settings,apply});
console.log(JSON.stringify({environment:'staging',mode:apply?'apply':'read-only',migrationVersion:version,ready,account:accountResult,...(!ready?{requiredNextStep:'Deploy the prepared v43 staging Worker; no account was created'}:{})}));
