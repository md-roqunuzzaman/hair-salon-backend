import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setup } from './test-support/public-worker.mjs';

test('Cloudflare feature licenses block alternate entry points and preserve existing paid obligations',async t=>{
  const ctx=await setup(t,'true'),f=ctx.fixture;
  const control=body=>ctx.direct('/__feature-license-test',body);
  const disabled=code=>control({reset:true,features:{[code]:{enabled:false}}});
  const reset=()=>control({reset:true});
  await t.test('discovery reflects all five features and is not cached',async()=>{
    await disabled('WALLET');const result=await ctx.api('/api/v1/features');assert.equal(Object.keys(result.data.features).length,5);assert.equal(result.data.features.WALLET.available,false);
    const response=await ctx.fetch('https://test/api/v1/features');assert.equal(response.headers.get('cache-control'),'no-store');
  });
  await t.test('GROUP_BUYING blocks both purchase routes, payment and both catalog routes without writing',async()=>{
    await disabled('GROUP_BUYING');const before=await ctx.state();
    for(const path of ['/api/v1/group-purchases','/api/v1/cancellation-refund/group-purchases/checkout'])await ctx.api(path,{body:{packageId:f.packageId,quantity:1,branchId:f.branchId},status:403});
    await ctx.api('/api/v1/payments/group-purchase/create-intent',{body:{groupPurchaseId:'11111111-1111-4111-8111-111111111111'},status:403});
    await ctx.api(`/api/v1/packages/${f.packageId}`,{status:403});await ctx.api(`/api/v1/branches/${f.branchId}/packages`,{status:403});assert.deepEqual(await ctx.state(),before);
  });
  await t.test('WALLET blocks both new-payment aliases, group payment and top-ups while retaining balance/history',async()=>{
    await disabled('WALLET');const before=await ctx.state(),id='11111111-1111-4111-8111-111111111111';
    for(const path of [`/api/v1/appointments/${id}/pay-with-wallet`,`/api/v1/wallet/${id}/pay-with-wallet`,`/api/v1/group-purchases/${id}/pay-with-wallet`])await ctx.api(path,{body:{useBonus:false},status:403});
    await ctx.api('/api/v1/wallet/topups',{body:{promotionId:id},status:403});await ctx.api('/api/v1/wallet');await ctx.api('/api/v1/wallet/transactions');assert.deepEqual(await ctx.state(),before);
  });
  await t.test('HAIRSTYLIST disables selection and staff APIs but retains automatic normal booking',async()=>{
    await disabled('HAIRSTYLIST');await ctx.api(`/api/v1/branches/${f.branchId}/staff`,{status:403});
    await ctx.api(`/api/v1/availability?${new URLSearchParams({branchId:f.branchId,packageId:f.packageId,date:f.date,staffId:f.staffId})}`,{status:403});
    const slots=(await ctx.api(`/api/v1/availability?${new URLSearchParams({branchId:f.branchId,packageId:f.packageId,date:f.date})}`)).data.slots;
    assert.ok(slots.length>0);assert.ok(slots.every(slot=>slot.staffId===null));
    await ctx.api('/api/v1/appointments/reserve',{body:{branchId:f.branchId,serviceId:f.serviceId,date:f.date,startTime:'09:00',staffId:f.staffId},status:403});
    const booked=await ctx.api('/api/v1/appointments/reserve',{body:{branchId:f.branchId,serviceId:f.serviceId,date:f.date,startTime:'09:00'},status:201});assert.ok(booked.data.appointmentId);
  });
  await t.test('service calls cannot bypass new purchase/top-up/payment checks',async()=>{
    await control({reset:true,features:{GROUP_BUYING:{enabled:false},WALLET:{enabled:false}}});const before=await ctx.state();
    assert.deepEqual(await control({probeServices:true}),{purchase:403,topup:403,appointmentPayment:403,purchasePayment:403});assert.deepEqual(await ctx.state(),before);
  });
  await t.test('REVIEWS disables direct and branch aliases',async()=>{
    await disabled('REVIEWS');await ctx.api('/api/v1/reviews',{status:403});await ctx.api(`/api/v1/branches/${f.branchId}/reviews`,{status:403});await ctx.api('/api/v1/appointments/11111111-1111-4111-8111-111111111111/reviews',{body:{rating:5,comment:'Synthetic'},status:403});
  });
  await t.test('expiry and globally disabled license deny new feature use',async()=>{
    await control({reset:true,features:{GROUP_BUYING:{expiresAt:'2000-01-01T00:00:00Z'}}});await ctx.api('/api/v1/group-purchases',{body:{},status:403});
    await control({reset:true,license:{enabled:false}});const summary=(await ctx.api('/api/v1/features')).data;assert.ok(Object.values(summary.features).every(x=>!x.available));await ctx.api('/api/v1/wallet/topups',{body:{},status:403});
  });
  await t.test('paid voucher redemption remains real, atomic and quantity-limited after GROUP_BUYING is disabled',async()=>{
    await reset();const purchase=(await ctx.api('/api/v1/group-purchases',{body:{packageId:f.packageId,quantity:1,branchId:f.branchId},status:201})).data;
    await ctx.api(`/api/v1/group-purchases/${purchase.purchaseId}/pay-with-wallet`,{body:{useBonus:false}});
    await disabled('GROUP_BUYING');await ctx.api(`/api/v1/group-purchases/${purchase.purchaseId}`);
    const path=`/api/v1/group-purchases/${purchase.purchaseId}/book-appointment`,body={branchId:f.branchId,date:f.date,startTime:'10:00',staffId:f.staffId};
    const booked=(await ctx.api(path,{body,status:201})).data;assert.ok(booked.appointmentId);assert.equal(booked.paymentStatus,'PAID');assert.equal(booked.bookingMethod,'GROUP_PURCHASE');assert.ok(booked.qr.token);assert.equal(booked.redemption.remainingQuantity,0);
    assert.equal(booked.appointmentStatus,'CONFIRMED');assert.equal(booked.qrAvailable,true);assert.equal(booked.additionalPaymentRequired,false);
    const row=(await ctx.state()).appointments.find(x=>x.id===booked.appointmentId);assert.equal(row.groupPurchaseId,purchase.purchaseId);assert.equal(row.currency,'HKD');assert.equal(Number(row.price),0);
    const before=await ctx.state();await ctx.api(path,{body:{...body,startTime:'11:00'},status:409});assert.deepEqual(await ctx.state(),before);
    const preview=(await ctx.api(`/api/v1/cancellation-refund/appointments/${booked.appointmentId}/preview`)).data;
    await ctx.api(`/api/v1/cancellation-refund/appointments/${booked.appointmentId}/cancel`,{body:{reason:'Synthetic voucher cancellation',idempotencyKey:randomUUID(),previewToken:preview.previewToken}});
  });
  await t.test('wallet-off customers can settle an existing deposit and retain ownership enforcement',async()=>{
    await reset();const booked=(await ctx.api('/api/v1/appointments/deposit',{body:{branchId:f.branchId,serviceId:f.serviceId,date:f.date,startTime:'12:00'},status:201})).data;
    await ctx.api(`/api/v1/appointments/${booked.appointmentId}/pay-with-wallet`,{body:{useBonus:false}});
    const row=(await ctx.state()).appointments.find(x=>x.id===booked.appointmentId);
    await ctx.api('/api/v1/appointments/verify-qr',{roleToken:ctx.ownerToken,body:{qrToken:row.qrToken,branchId:f.branchId}});
    await disabled('WALLET');await ctx.api(`/api/v1/wallet/${row.id}/remaining-payment/wallet`,{body:{useBonus:false}});
    assert.equal((await ctx.state()).appointments.find(x=>x.id===row.id).paymentStatus,'PAID');
  });
  await t.test('paid historical voucher keeps purchase currency when brand currency changes',async()=>{
    await reset();const purchase=(await ctx.api('/api/v1/group-purchases',{body:{packageId:f.packageId,quantity:1,branchId:f.branchId},status:201})).data;
    await ctx.api(`/api/v1/group-purchases/${purchase.purchaseId}/pay-with-wallet`,{body:{useBonus:false}});
    await ctx.api('/__policy-test',{body:{internationalSettings:{currency:'JPY'}}});await disabled('GROUP_BUYING');
    const before=await ctx.state();
    const booked=(await ctx.api(`/api/v1/group-purchases/${purchase.purchaseId}/book-appointment`,{body:{branchId:f.branchId,date:f.date,startTime:'13:00'},status:201})).data;
    assert.equal(booked.currency,'HKD');assert.equal(booked.price,0);assert.equal(booked.paymentStatus,'PAID');
    const after=await ctx.state();for(const key of ['payments','wallets','ledger'])assert.deepEqual(after[key],before[key]);
  });
});
