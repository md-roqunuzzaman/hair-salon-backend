import test from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './test-support/public-worker.mjs';
async function fixture(t,initial='stripe',remaining='wallet',persistent=false){
 const ctx=await setup(t,'true','false',persistent?`node_modules/.cloudflare-test/refund-restart-${crypto.randomUUID()}`:undefined),{api,fixture:f,ownerToken,state,webhook}=ctx;
 const control=body=>api('/__policy-test',{body});
 await api(`/api/v1/policy-management/branches/${f.branchId}/group-purchase-refunds`,{method:'PUT',roleToken:ownerToken,body:{isEnabled:true,refundAllowed:true,allowPartiallyUsedRefund:true,allowExpiredRefund:false,requireNoActiveAppointments:true,refundTiers:[{minimumMinutesAfterPurchase:0,refundPercentage:100}],expectedVersion:0}});
 const purchase=(await api('/api/v1/group-purchases',{body:{...f,quantity:2,purchaseFlow:'DIRECT_BOOK',bookingMethod:'DEPOSIT',startTime:'20:00'},status:201})).data;
 const purchaseId=purchase.purchaseId,appointmentId=purchase.firstAppointment.appointmentId;
 const pay=async provider=>{
  if(provider==='stripe'){
   const path=remainingStage?`/api/v1/payments/group-purchases/${purchaseId}/remaining-payment/stripe`:'/api/v1/payments/group-purchase/create-intent';
   const payment=(await api(path,{body:remainingStage?{}:{purchaseId},status:remainingStage?200:201})).data;
   await webhook(await api('/__book-now-provider',{body:{paymentId:payment.paymentId}}));return payment.paymentId;
  }
  const path=remainingStage?`/api/v1/wallet/group-purchases/${purchaseId}/remaining-payment/wallet`:`/api/v1/group-purchases/${purchaseId}/pay-with-wallet`;
  return (await api(path,{body:{useBonus:true}})).data.paymentId;
 };
 let remainingStage=false;await pay(initial);
 const appointment=(await state()).appointments.find(a=>a.id===appointmentId);
 assert.equal(Number((await state()).purchases.find(p=>p.id===purchaseId).depositAmount),60.15,'Deposit uses full 200.50 purchase');
 await api('/api/v1/appointments/verify-qr',{body:{qrToken:appointment.qrToken,branchId:f.branchId},roleToken:ownerToken});
 remainingStage=true;await pay(remaining);
 const root=`/api/v1/cancellation-refund/group-purchases/${purchaseId}`;
 const preview=async(status=200)=>api(root+'/refund-preview',{status});
 await api(root+'/refund-preview');
 const blocked=(await preview()).data;assert.equal(blocked.reason,'ACTIVE_APPOINTMENT_RESOLUTION_REQUIRED');
 await control({appointmentId,status:'COMPLETED'});
 const request=async(key='allocation-test')=>{
  const p=(await preview()).data;assert.equal(p.canRequestRefund,true);assert.equal(p.refund.refundAmount,100.25);
  return (await api(root+'/refund-request',{body:{reason:'Refund unused quantity',idempotencyKey:key,previewToken:p.previewToken}})).data;
 };
 const approve=id=>api(`/api/v1/refund-requests/${id}/review`,{method:'PATCH',roleToken:ownerToken,body:{decision:'APPROVE'}});
 const process=(id,status=200)=>api(`/api/v1/refund-requests/${id}/process`,{roleToken:ownerToken,body:{},status});
 const detail=id=>api(`/api/v1/refund-requests/${id}`,{roleToken:ownerToken}).then(r=>r.data);
 return {...ctx,control,purchaseId,appointmentId,preview,request,approve,process,detail};
}
for(const [first,last]of [['stripe','stripe'],['stripe','wallet'],['wallet','wallet']])test(`approved ${first}+${last} allocations preserve policy, provider identities and single finalization`,async t=>{
 const {api,request,approve,process,detail,state,purchaseId,ownerToken,control}=await fixture(t,first,last);
 const r=await request();assert.equal(Number(r.amount),100.25);
 assert.equal((await detail(r.id)).allocations.length,2);
 await process(r.id,409);
 await api(`/api/v1/refund-requests/${r.id}/review`,{method:'PATCH',body:{decision:'APPROVE'},status:403});
 await approve(r.id);const before=await state();
 const results=await Promise.all([process(r.id),process(r.id)]);assert.ok(results.every(r=>r.data.status==='COMPLETED'));
 const after=await state(),d=await detail(r.id),purchase=after.purchases.find(p=>p.id===purchaseId);
 assert.equal(d.refundRequest.status,'COMPLETED');assert.ok(d.allocations.every(a=>a.status==='SUCCEEDED'));
 assert.equal(d.allocations.reduce((s,a)=>s+Math.round(a.amount*100),0),10025);
 assert.equal(purchase.refundedQuantity,1);assert.equal(purchase.paymentStatus,'PARTIALLY_REFUNDED');
 assert.equal(after.notifications.filter(n=>n.type==='REFUND_COMPLETED').length-before.notifications.filter(n=>n.type==='REFUND_COMPLETED').length,1);
 const walletRefunds=after.ledger.filter(l=>l.type==='REFUND');assert.equal(new Set(walletRefunds.map(l=>l.ledgerKey)).size,walletRefunds.length);
 const count=(await control({})).providerRefundCount;await process(r.id);assert.equal((await control({})).providerRefundCount,count);assert.deepEqual(await state(),after);
 await api(`/api/v1/payments/${d.payment.id}/refund`,{body:{amount:1},roleToken:ownerToken,status:404});
});

test('mixed-provider pending/failed Stripe never completes parent or repeats wallet credit; webhook recovery is idempotent',async t=>{
 const {api,request,approve,process,detail,state,control,purchaseId,webhook}=await fixture(t);
 const r=await request();await approve(r.id);await control({refundMode:'pending'});
 await process(r.id,202);let d=await detail(r.id);assert.equal(d.refundRequest.status,'PROCESSING');assert.deepEqual(d.allocations.map(a=>a.status).sort(),['PROCESSING','SUCCEEDED']);
 assert.equal((await state()).purchases.find(p=>p.id===purchaseId).refundedQuantity,0);
 const after=await state(),count=(await control({})).providerRefundCount;
 await process(r.id,202);assert.equal((await control({})).providerRefundCount,count);assert.deepEqual(await state(),after);
 const stripe=d.allocations.find(a=>a.provider==='STRIPE');
 const event=await control({refundStatus:'succeeded',providerRefundId:stripe.providerRefundId});await webhook(event);const finished=await state();await webhook(event);await webhook({...event,id:event.id+'_again'});
 assert.deepEqual(await state(),finished);assert.equal((await detail(r.id)).refundRequest.status,'COMPLETED');
});

for(const failure of ['timeout','stripe','wallet'])test(`allocation recovery after ${failure} preserves intent and never duplicates funds`,async t=>{
 const {request,approve,process,detail,state,control,purchaseId}=await fixture(t);
 const r=await request();await approve(r.id);
 await control(failure==='timeout'?{refundMode:'timeout'}:{allocationFailure:failure});
 const before=await state();await process(r.id,202);
 const during=await state();assert.equal((await detail(r.id)).refundRequest.status,'PROCESSING');assert.equal(during.purchases.find(p=>p.id===purchaseId).refundedQuantity,0);
 if(failure==='wallet')assert.equal(during.ledger.filter(l=>l.type==='REFUND').length,before.ledger.filter(l=>l.type==='REFUND').length);
 const count=(await control({})).providerRefundCount;await control({allocationFailure:null,refundMode:'succeeded'});
 await process(r.id);const after=await state();assert.equal((await control({})).providerRefundCount,count);
 assert.equal((await detail(r.id)).refundRequest.status,'COMPLETED');assert.equal(after.purchases.find(p=>p.id===purchaseId).refundedQuantity,1);
 await process(r.id);assert.deepEqual(await state(),after);
});

test('ambiguous historical wallet deductions fail closed without changing balances',async t=>{
 const {control,preview,state,purchaseId}=await fixture(t,'wallet','wallet');
 await control({legacyWalletPurchase:purchaseId});const before=await state();
 const result=await preview(409);assert.equal(result.message,'WALLET_LEDGER_MANUAL_RECONCILIATION_REQUIRED');assert.deepEqual(await state(),before);
});

for(const status of ['failed','canceled'])test(`allocation ${status} remains inspectable, does not complete or reissue`,async t=>{
 const {request,approve,process,detail,control,state}=await fixture(t);
 const r=await request();await approve(r.id);await control({refundMode:status});
 await process(r.id,202);const d=await detail(r.id),after=await state();
 assert.equal(d.refundRequest.status,'PROCESSING');assert.ok(d.allocations.some(a=>a.status==='FAILED'));
 const count=(await control({})).providerRefundCount;await process(r.id,202);
 assert.equal((await control({})).providerRefundCount,count);
 assert.deepEqual((await state()).wallets,after.wallets);assert.deepEqual((await state()).ledger,after.ledger);
 assert.equal((await state()).notifications.filter(n=>n.type==='REFUND_COMPLETED').length,0);
});
test('partial original Stripe refund is subtracted and saved allocations cannot over-refund',async t=>{
 const {request,approve,process,detail,control,state,purchaseId}=await fixture(t,'stripe','stripe');
 const original=(await state()).payments.filter(p=>p.groupPurchaseId===purchaseId).sort((a,b)=>Number(a.amount)-Number(b.amount))[0];
 await control({priorRefundPayment:original.id});
 const r=await request();await approve(r.id);await process(r.id);
 const d=await detail(r.id);assert.equal(d.allocations.find(a=>a.paymentId===original.id).amount,50.15);
 const after=await state();for(const p of after.payments.filter(p=>p.groupPurchaseId===purchaseId))assert.ok(after.refunds.filter(r=>r.paymentId===p.id&&r.status==='SUCCEEDED').reduce((s,r)=>s+Math.round(Number(r.amount)*100),0)<=Math.round(Number(p.amount)*100));
});
test('concurrent request replay returns one parent; rejection releases only unsubmitted allocations',async t=>{
 const {api,preview,approve,process,detail,state,ownerToken,purchaseId}=await fixture(t);
 const p=(await preview()).data,root=`/api/v1/cancellation-refund/group-purchases/${purchaseId}/refund-request`;
 const body={reason:'Unused quantity',previewToken:p.previewToken,idempotencyKey:'concurrent-fixed-key'};
 const pair=await Promise.all([api(root,{body}),api(root,{body})]);assert.equal(pair[0].data.id,pair[1].data.id);
 const id=pair[0].data.id;
 await api(`/api/v1/refund-requests/${id}/review`,{method:'PATCH',roleToken:ownerToken,body:{decision:'REJECT',reviewNote:'Customer withdraws request'}});
 assert.ok((await detail(id)).allocations.every(a=>a.status==='CANCELLED'&&a.refundId===null));
 await process(id,409);assert.equal((await state()).refunds.length,0);
 assert.equal((await preview()).data.canRequestRefund,true);
});

test('accepted Stripe refund survives Worker restart using durable intent and provider lookup only',async t=>{
 const {request,approve,process,detail,state,control,restart}=await fixture(t,'stripe','wallet',true);
 const r=await request();await approve(r.id);await control({refundMode:'timeout'});await process(r.id,202);
 const providerState=(await control({})).providerState, before=await state();
 await restart();await control({restoreProviderState:providerState});await process(r.id);
 assert.equal((await detail(r.id)).refundRequest.status,'COMPLETED');
 assert.equal((await control({})).providerRefundCreateCalls,providerState.refundCreateCalls);
 assert.deepEqual((await state()).ledger,before.ledger);
});
