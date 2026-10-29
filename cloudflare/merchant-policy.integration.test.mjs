import assert from 'node:assert/strict';
import test from 'node:test';
import { setup } from './test-support/public-worker.mjs';
const servicePolicy={isEnabled:true,cancellationAllowed:true,refundAllowed:true,minimumCancellationHours:6,nonRefundable:false,deductionTiers:[{minimumHoursBeforeAppointment:48,calculationType:'PERCENTAGE',deductionValue:0},{minimumHoursBeforeAppointment:24,calculationType:'PERCENTAGE',deductionValue:20},{minimumHoursBeforeAppointment:12,calculationType:'PERCENTAGE',deductionValue:50},{minimumHoursBeforeAppointment:6,calculationType:'PERCENTAGE',deductionValue:100}]};
const groupRefundPolicy={isEnabled:true,refundAllowed:true,allowPartiallyUsedRefund:true,allowExpiredRefund:false,requireNoActiveAppointments:true,refundTiers:[{minimumHoursAfterPurchase:0,refundPercentage:100},{minimumHoursAfterPurchase:24,refundPercentage:80},{minimumHoursAfterPurchase:72,refundPercentage:0}]};
const groupCancelPolicy={isEnabled:true,cancellationAllowed:true,minimumCancellationHours:2,restorationMinimumHours:24,lateCancellationOutcome:'FORFEITED'};
test('merchant policies: real Worker APIs, snapshots, cancellation, approval and original funding refunds',async t=>{
  const {api,fixture,ownerToken,managerToken,otherManagerToken,state,webhook}=await setup(t,'true');
  const root='/api/v1/cancellation-refund',admin=`/api/v1/policy-management/branches/${fixture.branchId}`;
  const versions=new Map();
  const put=async(kind,body)=>{const p=(await api(`${admin}/${kind}`,{method:'PUT',body:{...body,expectedVersion:versions.get(kind)??0},roleToken:ownerToken})).data;versions.set(kind,p.version);return p;};
  const control=body=>api('/__policy-test',{body});
  let slot=0;
  const time=()=>{const n=slot++*30;return `${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;};
  const book=async(method='PAY_NOW',provider='WALLET',hours=25)=>{
    const created=(await api(`/api/v1/appointments/${method==='PAY_NOW'?'pay-now':method==='DEPOSIT'?'deposit':'reserve'}`,{body:{branchId:fixture.branchId,serviceId:fixture.serviceId,staffId:fixture.staffId,date:fixture.date,startTime:time()},status:201})).data;
    const id=created.appointmentId;
    let paymentId;
    if(method!=='RESERVE_NOW' && provider!=='NONE'){
      if(provider==='WALLET')await api(`/api/v1/appointments/${id}/pay-with-wallet`,{body:{useBonus:true}});
      else{const intent=(await api('/api/v1/payments/stripe/create-intent',{body:{appointmentId:id},status:201})).data;paymentId=intent.paymentId;await webhook(await api('/__book-now-provider',{body:{paymentId}}));}
    }
    await control({appointmentId:id,hoursBefore:hours});return {id,paymentId};
  };
  const preview=id=>api(`${root}/appointments/${id}/preview`).then(r=>r.data);
  const cancel=async(id,key,path=`${root}/appointments/${id}/cancel`)=>{const p=await preview(id);return (await api(path,{body:{reason:'Customer confirmed cancellation',idempotencyKey:key,previewToken:p.previewToken}})).data;};
  const approve=id=>api(`/api/v1/refund-requests/${id}/review`,{method:'PATCH',body:{decision:'APPROVE'},roleToken:ownerToken});
  const process=(id,status=200)=>api(`/api/v1/refund-requests/${id}/process`,{body:{},roleToken:ownerToken,status});
  await t.test('configuration RBAC, version guards and customer-safe display',async()=>{
    await api(`${admin}/service-cancellation`,{method:'PUT',body:servicePolicy,status:403});
    await api(`${admin}/service-cancellation`,{method:'PUT',body:servicePolicy,roleToken:otherManagerToken,status:403});
    await put('service-cancellation',servicePolicy);await put('group-purchase-refunds',groupRefundPolicy);await put('group-purchase-cancellations',groupCancelPolicy);
    await api(`${admin}/service-cancellation`,{method:'PUT',body:servicePolicy,roleToken:ownerToken,status:409});
    await api(`${admin}/service-cancellation`,{roleToken:managerToken});
    const display=(await api(`${root}/branches/${fixture.branchId}/service-policy`)).data;
    assert.equal(display.id,undefined);assert.equal(display.policyFormat,'DEDUCTION_V2');
  });
  for(const [hours,amount]of [[49,300],[25,240],[13,150],[7,0]])await t.test(`Wallet PAY_NOW ${hours}h refund ${amount}`,async()=>{
    const {id}=await book('PAY_NOW','WALLET',hours);const before=await state();const p=await preview(id);
    assert.equal(p.refund.refundAmount,amount);assert.equal(p.canCancel,true);assert.deepEqual(await state(),before);
    const result=await cancel(id,`wallet-${hours}`);assert.equal(result.refundAmount,amount);
    const requestCount=(await control({})).requests.length;
    const repeat=(await api(`${root}/appointments/${id}/cancel`,{body:{reason:'Customer confirmed cancellation',idempotencyKey:`wallet-${hours}`,previewToken:p.previewToken}})).data;
    assert.equal(repeat.refundRequestId,result.refundRequestId);assert.equal((await control({})).requests.length,requestCount);
    if(amount){await approve(result.refundRequestId);const beforeRefund=await state();await process(result.refundRequestId);const after=await state();const balance=r=>Math.round(Number(r.paidBalance)*100)+Math.round(Number(r.bonusBalance)*100);assert.equal(balance(after.wallets[0])-balance(beforeRefund.wallets[0]),amount*100);await process(result.refundRequestId,409);assert.deepEqual((await state()).wallets,after.wallets);}
    else assert.equal(result.refundRequestId,null);
  });
  await t.test('fixed deduction, disabled refunds and non-refundable cancellation are independent',async()=>{
    await put('service-cancellation',{...servicePolicy,deductionTiers:[{minimumHoursBeforeAppointment:6,calculationType:'FIXED',deductionValue:50}]});
    const fixed=await book();assert.equal((await preview(fixed.id)).refund.refundAmount,250);await cancel(fixed.id,'fixed-deduction');
    for(const changes of [{refundAllowed:false},{nonRefundable:true}]){await put('service-cancellation',{...servicePolicy,...changes});const {id}=await book();const p=await preview(id);assert.equal(p.canCancel,true);assert.equal(p.refund.refundAmount,0);assert.equal((await cancel(id,`zero-refund-${slot}`)).refundRequestId,null);}
    await put('service-cancellation',servicePolicy);
  });
  await t.test('snapshot survives policy changes; old cancel route enforces captured policy',async()=>{
    const {id}=await book();await put('service-cancellation',{...servicePolicy,cancellationAllowed:false});
    assert.equal((await preview(id)).refund.refundAmount,240);
    const result=(await api(`/api/v1/appointments/${id}/cancel`,{body:{reason:'Old endpoint confirmation'}})).data;
    assert.equal(result.refundStatus,'PENDING_APPROVAL');
    const disabled=await book();assert.equal((await preview(disabled.id)).canCancel,false);await api(`/api/v1/appointments/${disabled.id}/cancel`,{body:{reason:'Must not bypass'},status:409});
    await put('service-cancellation',servicePolicy);
  });
  await t.test('cutoff, unpaid Reserve Now, stale preview and unauthorized owner access',async()=>{
    const late=await book('RESERVE_NOW','NONE',5);assert.equal((await preview(late.id)).canCancel,false);
    const unpaid=await book('RESERVE_NOW','NONE',25);assert.equal((await cancel(unpaid.id,'reserve-no-refund')).refundRequestId,null);
    const changed=await book();const old=await preview(changed.id);await control({appointmentId:changed.id,hoursBefore:13});await api(`${root}/appointments/${changed.id}/cancel`,{body:{reason:'Stale confirmation',idempotencyKey:'stale-preview',previewToken:old.previewToken},status:409});
    const register=(await api('/api/v1/auth/register',{body:{name:'Other customer',email:'other-policy@example.com',password:'StrongPassword123!'},status:201})).data;
    const otherToken=(await api('/api/v1/auth/login',{body:{email:'other-policy@example.com',password:'StrongPassword123!'}})).data.accessToken;
    await api(`${root}/appointments/${changed.id}/preview`,{roleToken:otherToken,status:403});assert.ok(register.id);
    await control({appointmentId:changed.id,clearSnapshot:true});await api(`${root}/appointments/${changed.id}/preview`,{status:409});
  });
  for(const mode of ['succeeded','pending','timeout','failed'])await t.test(`Stripe ${mode}: signed success and safe refund reconciliation`,async()=>{
    await control({refundMode:mode});const beforeProvider=await control({});const {id}=await book('PAY_NOW','STRIPE',25);const result=await cancel(id,`stripe-${mode}`);await approve(result.refundRequestId);
    await process(result.refundRequestId,mode==='timeout'||mode==='failed'?502:mode==='pending'?202:200);
    const provider=await control({});assert.equal(provider.providerRefundCount,beforeProvider.providerRefundCount+1);
    if(mode==='pending'){const latest=provider.providerRefunds.at(-1);const event=await control({providerRefundId:latest.id,refundStatus:'succeeded'});await webhook(event);await webhook({...event,id:`${event.id}_duplicate`});}
    if(mode==='timeout')await process(result.refundRequestId);
    const current=await control({});assert.equal(current.requests.find(r=>r.id===result.refundRequestId).status,mode==='failed'?'FAILED':'COMPLETED');assert.equal(current.providerRefundCount,provider.providerRefundCount);
  });
  await control({refundMode:'succeeded'});
  await t.test('DEPOSIT refunds only the deposit before arrival; checked-in remainder collection cannot bypass cancellation protection',async()=>{
    await api('/__book-now-policy',{body:{branchId:fixture.branchId,data:{depositPercentage:10}}});
    const beforeArrival=await book('DEPOSIT','STRIPE',25);
    assert.equal((await preview(beforeArrival.id)).refund.eligiblePaidAmount,30);assert.equal((await preview(beforeArrival.id)).refund.refundAmount,24);
    const request=await cancel(beforeArrival.id,'deposit-before-arrival');await approve(request.refundRequestId);await process(request.refundRequestId);
    const {id}=await book('DEPOSIT','STRIPE',25);let appointment=(await state()).appointments.find(a=>a.id===id);
    await api('/api/v1/appointments/verify-qr',{body:{qrToken:appointment.qrToken,branchId:fixture.branchId,paymentMethod:'CASH'},roleToken:ownerToken});
    await api(`/api/v1/appointments/${id}/remaining-payment`,{body:{paymentMethod:'CASH'},roleToken:ownerToken});
    assert.equal((await preview(id)).refund.eligiblePaidAmount,30);assert.equal((await preview(id)).canCancel,false);assert.equal((await preview(id)).refund.refundAmount,0);
    await api(`/api/v1/appointments/${id}/cancel`,{body:{reason:'Checked-in protection'},status:409});
  });
  const buy=async(quantity=2)=>{const created=(await api('/api/v1/group-purchases',{body:{packageId:fixture.packageId,branchId:fixture.branchId,quantity,purchaseFlow:'BUY_NOW_BOOK_LATER'},status:201})).data;await api(`/api/v1/group-purchases/${created.purchaseId}/pay-with-wallet`,{body:{useBonus:true}});return created.purchaseId;};
  const redeem=async id=>(await api(`/api/v1/group-purchases/${id}/book-appointment`,{body:{branchId:fixture.branchId,date:fixture.date,startTime:time()},status:201})).data;
  await t.test('configured Buy Later requires explicit branch without changing its route',async()=>{await api('/api/v1/group-purchases',{body:{packageId:fixture.packageId,quantity:1},status:422});});
  await t.test('early/late group cancellation restores/forfeits once and prevents excess redemption',async()=>{
    const id=await buy(2);const a=await redeem(id);const b=await redeem(id);const aid=a.appointmentId,bid=b.appointmentId;
    await control({appointmentId:aid,hoursBefore:25});await control({appointmentId:bid,hoursBefore:13});
    const early=await cancel(aid,'group-restore',`${root}/group-purchase-appointments/${aid}/cancel`);assert.equal(early.entitlementOutcome,'RESTORED');
    const late=await cancel(bid,'group-forfeit',`${root}/group-purchase-appointments/${bid}/cancel`);assert.equal(late.entitlementOutcome,'FORFEITED');
    const p=await preview(bid);await api(`${root}/group-purchase-appointments/${bid}/cancel`,{body:{reason:'Customer confirmed cancellation',idempotencyKey:'group-forfeit',previewToken:p.previewToken}});
    const purchase=(await state()).purchases.find(p=>p.id===id);assert.equal(purchase.forfeitedQuantity,1);await redeem(id);await api(`/api/v1/group-purchases/${id}/book-appointment`,{body:{branchId:fixture.branchId,date:fixture.date,startTime:time()},status:409});
  });
  await t.test('partial used-package refund, duplicate request and refund/redemption exclusion',async()=>{
    const id=await buy(2);const a=await redeem(id);await control({appointmentId:a.appointmentId,status:'COMPLETED'});
    const p=(await api(`${root}/group-purchases/${id}/refund-preview`)).data;assert.equal(p.remainingRefundableQuantity,1);assert.equal(p.refund.refundAmount,100.25);
    const body={reason:'Refund unused entitlement',idempotencyKey:'partial-group-refund',previewToken:p.previewToken};const request=(await api(`${root}/group-purchases/${id}/refund-request`,{body})).data;
    assert.equal((await api(`${root}/group-purchases/${id}/refund-request`,{body})).data.id,request.id);
    await api(`/api/v1/group-purchases/${id}/book-appointment`,{body:{branchId:fixture.branchId,date:fixture.date,startTime:time()},status:409});
    await approve(request.id);await process(request.id);const purchase=(await state()).purchases.find(p=>p.id===id);assert.equal(purchase.refundedQuantity,1);assert.equal(purchase.paymentStatus,'REFUNDED');
    await api(`/api/v1/group-purchases/${id}/book-appointment`,{body:{branchId:fixture.branchId,date:fixture.date,startTime:time()},status:409});
  });
  await t.test('active reservations block package refunds; group age and zero-refund tiers are explicit',async()=>{
    const id=await buy(2);const a=await redeem(id);let p=(await api(`${root}/group-purchases/${id}/refund-preview`)).data;assert.equal(p.canRequestRefund,false);
    await control({appointmentId:a.appointmentId,hoursBefore:25});await cancel(a.appointmentId,'resolve-active-package');
    await control({purchaseId:id,ageHours:25});p=(await api(`${root}/group-purchases/${id}/refund-preview`)).data;assert.equal(p.refund.refundAmount,160.4);
    await control({purchaseId:id,ageHours:73});p=(await api(`${root}/group-purchases/${id}/refund-preview`)).data;assert.equal(p.refund.refundAmount,0);assert.equal(p.canRequestRefund,false);
  });
  await t.test('concurrent cancellation and Wallet processing have one durable effect',async()=>{
    const {id}=await book();const p=await preview(id);const before=await control({});
    const body={reason:'Concurrent customer cancellation',idempotencyKey:'concurrent-cancellation',previewToken:p.previewToken};
    const results=await Promise.all([api(`${root}/appointments/${id}/cancel`,{body}),api(`${root}/appointments/${id}/cancel`,{body})]);
    assert.equal(results[0].data.refundRequestId,results[1].data.refundRequestId);
    assert.equal((await control({})).requests.length,before.requests.length+1);
    const requestId=results[0].data.refundRequestId;await approve(requestId);const beforeProcessing=await state();const walletBefore=beforeProcessing.wallets[0];
    const processed=await Promise.allSettled([process(requestId),process(requestId)]);assert.equal(processed.filter(r=>r.status==='fulfilled').length,1);
    const walletAfter=(await state()).wallets[0];const total=w=>Number(w.paidBalance)+Number(w.bonusBalance);
    assert.equal(Math.round((total(walletAfter)-total(walletBefore))*100),24000);
    assert.equal((await state()).notifications.filter(n=>n.type==='REFUND_COMPLETED').length,beforeProcessing.notifications.filter(n=>n.type==='REFUND_COMPLETED').length+1);
  });
  await t.test('successful cancellation releases the exact staff slot for another booking',async()=>{
    const body={branchId:fixture.branchId,serviceId:fixture.serviceId,staffId:fixture.staffId,date:fixture.date,startTime:time()};
    const first=(await api('/api/v1/appointments/reserve',{body,status:201})).data;
    await api('/api/v1/appointments/reserve',{body,status:409});
    await cancel(first.appointmentId,'release-staff-capacity');
    const next=(await api('/api/v1/appointments/reserve',{body,status:201})).data;assert.notEqual(next.appointmentId,first.appointmentId);
  });
  await t.test('ordinary Wallet checkout rejects a DEPOSIT hold without changing financial records',async()=>{
    const {id}=await book('DEPOSIT','NONE',25);const before=await state();
    await api(`/api/v1/appointments/${id}/pay-with-wallet`,{body:{useBonus:true},status:409});
    assert.deepEqual(await state(),before);
  });
  await t.test('Stripe full unused group refund settles once and invalidates remaining quantity',async()=>{
    const purchase=(await api('/api/v1/group-purchases',{body:{packageId:fixture.packageId,branchId:fixture.branchId,quantity:2},status:201})).data;
    const intent=(await api('/api/v1/payments/group-purchase/create-intent',{body:{purchaseId:purchase.purchaseId},status:201})).data;
    await webhook(await api('/__book-now-provider',{body:{paymentId:intent.paymentId}}));
    const p=(await api(`${root}/group-purchases/${purchase.purchaseId}/refund-preview`)).data;assert.equal(p.refund.refundAmount,200.5);
    const request=(await api(`${root}/group-purchases/${purchase.purchaseId}/refund-request`,{body:{reason:'Refund entire unused package',idempotencyKey:'stripe-unused-package',previewToken:p.previewToken}})).data;
    await approve(request.id);await process(request.id);await process(request.id,409);
    assert.equal((await state()).purchases.find(r=>r.id===purchase.purchaseId).refundedQuantity,2);
  });
  await t.test('expiry and partial-use permissions use purchase snapshots',async()=>{
    await control({packageId:fixture.packageId,validDays:1});const id=await buy(2);
    await control({purchaseId:id,ageHours:25});let p=(await api(`${root}/group-purchases/${id}/refund-preview`)).data;assert.equal(p.reason,'GROUP_PURCHASE_EXPIRED');
    await put('group-purchase-refunds',{...groupRefundPolicy,allowExpiredRefund:true,allowPartiallyUsedRefund:false});
    p=(await api(`${root}/group-purchases/${id}/refund-preview`)).data;assert.equal(p.reason,'GROUP_PURCHASE_EXPIRED');
    const next=await buy(2);await control({purchaseId:next,ageHours:25});p=(await api(`${root}/group-purchases/${next}/refund-preview`)).data;assert.equal(p.canRequestRefund,true);
    const unused=await buy(2);const appointment=await redeem(unused);await control({appointmentId:appointment.appointmentId,status:'COMPLETED'});
    assert.equal((await api(`${root}/group-purchases/${unused}/refund-preview`)).data.reason,'USED_GROUP_PURCHASE_NOT_REFUNDABLE');
  });
  await t.test('refund and cancellation flows retain in-app notifications but enqueue no business email',async()=>{
    const rows=(await api('/__business-email-test',{body:{}})).jobs;
    const refunds=(await state()).refunds;
    assert.ok(refunds.some(r=>r.status==='SUCCEEDED'));
    for(const r of refunds)assert.equal(rows.filter(j=>j.eventType==='REFUND_COMPLETED'&&j.idempotencyKey.endsWith(`:${r.id}`)).length,0);
    assert.equal(new Set(rows.map(j=>j.idempotencyKey)).size,rows.length);
    assert.equal(rows.length,0,'All automatic email integrations are retired');
  });
});
