import test from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './test-support/public-worker.mjs';
import { pricingSeeds } from '../scripts/lib/cloudflare-saas-pricing.mjs';

test('Worker SaaS seed matches Cloudflare SQL seed, calculates Decimal pricing and stores subscription snapshots/relations',async t=>{
  const ctx=await setup(t,'true');
  const before=await ctx.state();
  const seeded=await ctx.direct('/__subscription-test',{calculate:true,snapshot:true});
  assert.equal(seeded.plans.length,1);assert.equal(seeded.addons.length,5);
  for(const seed of pricingSeeds){
    const row=(seed.table==='SubscriptionPlan'?seeded.plans:seeded.addons).find(row=>row.code===seed.code);
    assert.equal(row.name,seed.name);assert.equal(row.description,seed.description);
    assert.equal(Number(row.price)*100,seed.price);assert.equal(row.currency,'HKD');assert.equal(row.isActive,true);
  }
  assert.equal(seeded.calculated.basePrice,'500');assert.equal(seeded.calculated.addonsPrice,'170');assert.equal(seeded.calculated.totalPrice,'670');
  assert.equal(seeded.snapshot.basePrice,'500.25');assert.equal(seeded.snapshot.addonsPrice,'120.5');assert.equal(seeded.snapshot.totalPrice,'620.75');
  assert.equal(seeded.snapshot.plan.code,'STANDARD');assert.equal(seeded.snapshot.brand.id,seeded.snapshot.brandId);assert.equal(seeded.snapshot.addons[0].addon.code,'WALLET');
  const again=await ctx.direct('/__subscription-test',{});
  assert.deepEqual(again.plans,seeded.plans);assert.deepEqual(again.addons,seeded.addons);
  const after=await ctx.state();for(const key of ['payments','refunds','wallets','ledger','purchases','appointments'])assert.deepEqual(after[key],before[key]);
});

test('Worker seed preserves administrator pricing, descriptions, status and timestamps on repeat runs',async t=>{
  const ctx=await setup(t,'true');
  const changed=await ctx.direct('/__subscription-test',{customize:true});
  assert.equal(changed.plans[0].price,'501.25');assert.equal(changed.plans[0].name,'Custom Plan');assert.equal(changed.plans[0].isActive,false);
  const wallet=changed.addons.find(row=>row.code==='WALLET');assert.equal(wallet.price,'123.45');assert.equal(wallet.name,'Custom Wallet');assert.equal(wallet.isActive,false);
  assert.deepEqual(await ctx.direct('/__subscription-test',{}),changed);
});
