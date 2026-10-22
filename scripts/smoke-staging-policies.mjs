// Public reads and unauthenticated authorization probes only. No credentials or payment operations.
import { writeFile } from 'node:fs/promises';
const base='https://hair-salon-backend-staging.icy-dew-e559.workers.dev';
const branch='f7318524-db7c-49cf-8bc4-bfc6ff5c6b97';
const placeholder='00000000-0000-4000-8000-000000000001';
const probes=[['GET','/',200],['GET','/api/v1/packages/9ff78b23-f681-4007-a44c-ef4277decf17',200],['GET','/api/v1/appointments/my',401],['GET','/api/v1/wallet',401],['GET','/api/v1/refund-requests',401]];
for(const module of ['service-cancellation','group-purchase-refunds','group-purchase-cancellations'])for(const method of ['GET','PUT'])probes.push([method,`/api/v1/policy-management/branches/${branch}/${module}`,401]);
probes.push(['GET',`/api/v1/cancellation-refund/branches/${branch}/service-policy`,404],['GET',`/api/v1/cancellation-refund/branches/${branch}/group-purchase-refund-policy`,200],['GET',`/api/v1/cancellation-refund/branches/${branch}/group-purchase-cancellation-policy`,404]);
probes.push(['GET',`/api/v1/cancellation-refund/appointments/${placeholder}/preview`,401],['GET',`/api/v1/cancellation-refund/group-purchases/${placeholder}/refund-preview`,401]);
for(const path of [`appointments/${placeholder}/cancel`,`group-purchase-appointments/${placeholder}/cancel`,`group-purchases/${placeholder}/refund-request`,'group-purchases/checkout'])probes.push(['POST',`/api/v1/cancellation-refund/${path}`,401]);
const results=[];
try {
  for(const [method,path,expected] of probes) {
    const response=await fetch(base+path,{method,redirect:'error',signal:AbortSignal.timeout(30000)});
    const body=await response.json();
    const passed=response.status===expected&&(expected===200?body.success===true:body.success===false)&&(!(expected===404)||body.message==='POLICY_NOT_CONFIGURED');
    results.push({method,path,status:response.status,expected,passed});
    if(!passed)throw Error('SMOKE_CHECK_FAILED');
  }
  await writeFile('.maintenance-backups/staging-pre-upgrade/final-smoke-tests.json',JSON.stringify(results,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({passed:results.length,failed:0,newPolicyRoutes:15,publicPolicy200:1,unconfiguredPolicy404:2,unauthorizedPolicy401:12}));
}catch {
  console.error(JSON.stringify({error:'SMOKE_CHECK_FAILED_OR_UNAVAILABLE',completed:results.length,lastCheck:results.at(-1)}));
  process.exitCode=1;
}
