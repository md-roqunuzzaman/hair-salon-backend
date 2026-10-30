import test from 'node:test';
import assert from 'node:assert/strict';
import {setup} from './test-support/public-worker.mjs';
for(const kind of ['appointment-initial','appointment-remaining','group-remaining'])test(`captured losing ${kind} is refunded once without changing winning funds`,async t=>{
 const {api,fixture:f,state,webhook,ownerToken}=await setup(t,'true');
 const control=body=>api('/__policy-test',{body});
 let appointmentId,purchaseId,paymentId;
 if(kind==='group-remaining'){
  const p=(await api('/api/v1/group-purchases',{body:{...f,quantity:1,purchaseFlow:'DIRECT_BOOK',bookingMethod:'DEPOSIT',startTime:'12:00'},status:201})).data;
  purchaseId=p.purchaseId;appointmentId=p.firstAppointment.appointmentId;
  await api(`/api/v1/group-purchases/${purchaseId}/pay-with-wallet`,{body:{useBonus:true}});
  const a=(await state()).appointments.find(a=>a.id===appointmentId);
  await api('/api/v1/appointments/verify-qr',{body:{qrToken:a.qrToken,branchId:f.branchId},roleToken:ownerToken});
  paymentId=(await api(`/api/v1/payments/group-purchases/${purchaseId}/remaining-payment/stripe`,{body:{}})).data.paymentId;
  await webhook(await api('/__book-now-provider',{body:{paymentId,failed:true}}));
  await api(`/api/v1/wallet/group-purchases/${purchaseId}/remaining-payment/wallet`,{body:{useBonus:true}});
 }else if(kind==='appointment-remaining'){
  const customerId=(await state()).wallets[0].customerId;
  appointmentId=(await control({remainingDeposit:{...f,customerId}})).appointmentId;
  paymentId=(await api(`/api/v1/payments/appointments/${appointmentId}/remaining-payment/stripe`,{body:{}})).data.paymentId;
  await webhook(await api('/__book-now-provider',{body:{paymentId,failed:true}}));
  await api(`/api/v1/wallet/${appointmentId}/remaining-payment/wallet`,{body:{useBonus:true}});
 }else{
  appointmentId=(await api('/api/v1/appointments/pay-now',{body:{branchId:f.branchId,serviceId:f.serviceId,staffId:f.staffId,date:f.date,startTime:'12:00'},status:201})).data.appointmentId;
  paymentId=(await api('/api/v1/payments/stripe/create-intent',{body:{appointmentId},status:201})).data.paymentId;
  // Same intent can recover after a failed attempt; customer instead pays via wallet.
  await webhook(await api('/__book-now-provider',{body:{paymentId,failed:true}}));
  await api(`/api/v1/appointments/${appointmentId}/pay-with-wallet`,{body:{useBonus:true}});
 }
 const before=await state(),event=await api('/__book-now-provider',{body:{paymentId}});
 await control({failIntentRead:true});await webhook(event,503);
 const durable=(await state()).refunds.find(r=>r.paymentId===paymentId);
 assert.equal(durable.status,'PENDING');assert.equal(durable.refundAttemptedAt,null);
 assert.equal((await state()).payments.find(p=>p.id===paymentId).status,'PAID');
 await control({failIntentRead:false});await webhook(event);const after=await state();
 assert.equal(after.payments.find(p=>p.id===paymentId).status,'REFUNDED');
 assert.deepEqual(after.appointments.find(a=>a.id===appointmentId),before.appointments.find(a=>a.id===appointmentId));
 if(purchaseId)assert.deepEqual(after.purchases.find(p=>p.id===purchaseId),before.purchases.find(p=>p.id===purchaseId));
 assert.deepEqual(after.wallets,before.wallets);assert.deepEqual(after.ledger,before.ledger);
 assert.equal(after.refunds.filter(r=>r.paymentId===paymentId&&r.status==='SUCCEEDED').length,1);
 const count=(await control({})).providerRefundCount;
 await webhook(event);await webhook({...event,id:event.id+'_duplicate'});
 assert.equal((await control({})).providerRefundCount,count);assert.deepEqual(await state(),after);
});

test('expired appointment capture timeout reconciles by lookup without resubmission or reactivation',async t=>{
 const {api,fixture:f,webhook,state}=await setup(t,'true');const control=body=>api('/__policy-test',{body});
 const appointmentId=(await api('/api/v1/appointments/pay-now',{body:{branchId:f.branchId,serviceId:f.serviceId,staffId:f.staffId,date:f.date,startTime:'10:00'},status:201})).data.appointmentId;
 const {paymentId}=(await api('/api/v1/payments/stripe/create-intent',{body:{appointmentId},status:201})).data;
 await control({appointmentId,status:'EXPIRED',refundMode:'timeout'});
 const event=await api('/__book-now-provider',{body:{paymentId}});await webhook(event,503);
 const pending=(await state()).refunds.find(r=>r.paymentId===paymentId);assert.equal(pending.status,'PENDING');assert.ok(pending.refundAttemptedAt);
 const calls=(await control({})).providerRefundCreateCalls;
 await webhook(event);const after=await state();assert.equal(after.refunds.find(r=>r.id===pending.id).status,'SUCCEEDED');assert.equal(after.appointments.find(a=>a.id===appointmentId).appointmentStatus,'EXPIRED');
 assert.equal((await control({})).providerRefundCreateCalls,calls);await webhook({...event,id:event.id+'_again'});assert.deepEqual(await state(),after);
});
