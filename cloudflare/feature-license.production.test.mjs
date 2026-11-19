import test from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import { getFeatureLicenseSummary,isFeatureAvailable } from '../src/app/utils/featureLicense.ts';

test('Production Worker ships the real client license and exposes no test control or license mutation endpoint',async t=>{
  const mf=new Miniflare({modules:true,scriptPath:'cloudflare/.build/worker.mjs',compatibilityDate:'2025-10-11',compatibilityFlags:['nodejs_compat','enable_nodejs_http_server_modules'],modulesRules:[{type:'CompiledWasm',include:['**/*.wasm']}],durableObjects:{SALON_DB:{className:'SalonDatabase',useSQLite:true}},outboundService:async()=>{throw new Error('External I/O forbidden in license smoke test');},bindings:{NODE_ENV:'production',CORS_ORIGIN:'https://frontend.example.com',JWT_ACCESS_SECRET:'synthetic-production-access-'.repeat(3),JWT_REFRESH_SECRET:'synthetic-production-refresh-'.repeat(3),STRIPE_SECRET_KEY:'sk_test_fixture',OPENAI_API_KEY:'synthetic',R2_ACCOUNT_ID:'synthetic',R2_ACCESS_KEY_ID:'synthetic',R2_SECRET_ACCESS_KEY:'synthetic',R2_BUCKET_NAME:'synthetic',EMAIL_OUTBOX_ENABLED:'false'}});
  t.after(()=>mf.dispose());
  const result=await mf.dispatchFetch('https://test/api/v1/features');assert.equal(result.status,200);assert.equal(result.headers.get('cache-control'),'no-store');assert.deepEqual((await result.json()).data,getFeatureLicenseSummary());
  for(const path of ['/__feature-license-test','/api/v1/features']){
    const response=await mf.dispatchFetch('https://test'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({features:{WALLET:{enabled:true}}})});assert.equal(response.status,404);
  }
  const topup=await mf.dispatchFetch('https://test/api/v1/wallet/topups',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});assert.equal(topup.status,401);
  const promotions=await mf.dispatchFetch('https://test/api/v1/promotions');assert.equal(promotions.status,isFeatureAvailable('WALLET')?401:403);
  assert.deepEqual((await(await mf.dispatchFetch('https://test/api/v1/features')).json()).data,getFeatureLicenseSummary());
});
