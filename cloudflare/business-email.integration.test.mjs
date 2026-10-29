import test from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './test-support/public-worker.mjs';

test('retired email: customer bookings, payments, wallet, reschedules and cancellation retain business/in-app results',async t=>{
 const {api,fixture,webhook}=await setup(t,'true','true');
 const jobs=async()=>(await api('/__business-email-test',{body:{}})).jobs;
 const book=async(method,time)=>(await api(`/api/v1/appointments/${method}`,{body:{branchId:fixture.branchId,serviceId:fixture.serviceId,staffId:fixture.staffId,date:fixture.date,startTime:time},status:201})).data.appointmentId;
 const pay=async id=>{const p=(await api('/api/v1/payments/stripe/create-intent',{body:{appointmentId:id},status:201})).data;const event=await api('/__book-now-provider',{body:{paymentId:p.paymentId}});await webhook(event);await webhook(event);await webhook({...event,id:event.id+'_replay'});};
 const platformBefore=(await api('/__outbox')).length;
 const paid=await book('pay-now','08:00');await pay(paid);
 const deposit=await book('deposit','09:00');await pay(deposit);
 const reserved=await book('reserve','10:00');
 for(const time of ['11:00','11:00','12:00'])await api(`/api/v1/appointments/${reserved}/reschedule`,{body:{date:fixture.date,startTime:time,staffId:fixture.staffId}});
 await api(`/api/v1/appointments/${reserved}/reschedule`,{body:{date:fixture.date,startTime:'09:00',staffId:fixture.staffId},status:409});
 await api(`/api/v1/appointments/${reserved}/cancel`,{body:{reason:'Synthetic cancellation'}});
 const wallet=await book('pay-now','14:00');await api(`/api/v1/appointments/${wallet}/pay-with-wallet`,{body:{useBonus:true}});
 const state=await api('/__snapshot');
 assert.equal(state.appointments.find(a=>a.id===paid).appointmentStatus,'CONFIRMED');
 assert.equal(state.appointments.find(a=>a.id===deposit).paymentStatus,'PARTIALLY_PAID');
 assert.equal(state.appointments.find(a=>a.id===reserved).appointmentStatus,'CANCELLED');
 assert.equal(state.appointments.find(a=>a.id===wallet).paymentStatus,'PAID');
 for(const type of ['BOOKING_RESCHEDULED','BOOKING_CANCELLED'])assert.ok(state.notifications.some(n=>n.type===type),type+' in-app notification preserved');
 assert.ok(state.notifications.some(n=>n.type.includes('CONFIRMED')),'Payment in-app notification retained');
 assert.deepEqual(await jobs(),[]);assert.equal((await api('/__outbox')).length,platformBefore,'No automatic SMTP delivery');
});

test('retired processor cannot send/recover/retry even with flag true; unrelated cron tasks still execute',async t=>{
 const {api,cron,scheduled}=await setup(t,'true','true');const control=body=>api('/__business-email-test',{body});
 const {brandId}=await api('/__email-test-control',{body:{}});
 for(const status of ['PENDING','PROCESSING','SENDING','DELIVERY_UNCERTAIN','SKIPPED','FAILED','SENT'])await control({seed:{status,lockedUntil:new Date(0).toISOString(),attempts:1}});
 const before=(await control({})).jobs;const platform=(await api('/__outbox')).length;const provider=(await api('/__email-test-control',{body:{}})).requests.length;
 for(const job of before){const results=await control({one:job.id,concurrent:2});assert.ok(results.every(r=>r.processed===false&&r.reason==='EMAIL_BUSINESS_EMAILS_RETIRED'));}
 assert.equal((await control({batch:10})).enabled,false);assert.equal((await control({recover:true})).recovered,0);
 await cron();await scheduled();await api('/__email-cron-failure',{status:500});
 assert.deepEqual((await control({})).jobs,before,'Runtime never changes/replays legacy states');
 assert.equal((await api('/__outbox')).length,platform);assert.equal((await api('/__email-test-control',{body:{}})).requests.length,provider);
});

test('owner management: pagination, filters, audit, redaction, skip fencing and history', async t => {
  const {api,ownerToken,managerToken}=await setup(t,'true');
  const control=body=>api('/__business-email-test',{body});
  const {brandId}=await api('/__email-test-control',{body:{}}); const root=`/api/v1/brand-email-settings/${brandId}/outbox`;
  const owner=(url,options={})=>api(url,{...options,roleToken:ownerToken}); const ids=[];
  for(let i=0;i<3;i++)ids.push((await control({seed:{eventType:i===2?'REFUND_COMPLETED':'BOOKING_CANCELLED'}})).id);
  const page=await owner(root+'?page=1&limit=2');assert.equal(page.data.length,2);assert.equal(page.pagination.total,3);
  const second=await owner(root+'?page=2&limit=2');assert.equal(second.data.length,1);assert.ok(!page.data.some(j=>j.id===second.data[0].id));
  assert.equal((await owner(root+'?eventType=REFUND_COMPLETED')).pagination.total,1);
  assert.equal((await owner(root+'?recipientEmail=synthetic%40example.com')).pagination.total,3);
  assert.equal((await owner(root+'?recipientEmail=other%40example.com')).pagination.total,0);
  const audit=await owner(root+'/audit?status=PENDING');assert.equal(audit.summary.statusCounts.PENDING,3);assert.ok(audit.data.every(j=>j.audit.disposition==='RETIRED'));
  assert.doesNotMatch(JSON.stringify(audit),/recipientEmail|synthetic@example.com|subject|html|claimToken|validationData/);
  for(const path of [root,root+'/audit',root+'/'+ids[0],root+'/'+ids[0]+'/history']){
    await api(path,{roleToken:managerToken,status:403});await api(path,{roleToken:'',status:401});
  }
  for(const query of ['limit=101','page=0','status=UNKNOWN','createdFrom=bad','extra=1'])await owner(root+'?'+query,{status:400});
  await owner(root+'/'+ids[0]+'/skip',{body:{reason:'TEST_ONLY'}});
  const history=(await owner(root+'/'+ids[0]+'/history')).data;assert.equal(history.length,1);assert.equal(history[0].code,'EMAIL_OWNER_SKIP_TEST_ONLY');assert.ok(history[0].actorId);
  assert.equal((await owner(root+'/'+ids[0])).data.status,'SKIPPED');await owner(root+'/'+ids[0]+'/skip',{body:{reason:'TEST_ONLY'},status:409});
  await control({patch:{id:ids[1],data:{status:'DELIVERY_UNCERTAIN'}}});await owner(root+'/'+ids[1]+'/skip',{body:{reason:'OWNER_REQUEST'},status:409});
  await control({patch:{id:ids[2],data:{lockedUntil:new Date(Date.now()+60000).toISOString()}}});await owner(root+'/'+ids[2]+'/skip',{body:{reason:'OWNER_REQUEST'},status:409});
  await owner(root+'/11111111-1111-4111-8111-111111111111',{status:404});
  await api('/api/v1/brand-email-settings/11111111-1111-4111-8111-111111111111/outbox/audit',{roleToken:ownerToken,status:403});
});



test('platform OTP and reset confirmation remain independent of retired business email and broken merchant SMTP',async t=>{
 const {api,ownerToken}=await setup(t,'true','true');
 const {brandId}=await api('/__email-test-control',{body:{}});
 await api(`/api/v1/brand-email-settings/${brandId}`,{roleToken:ownerToken,method:'PUT',body:{provider:'GMAIL',fromName:'Synthetic',fromEmail:'synthetic@gmail.com',smtpUsername:'synthetic@gmail.com',password:'abcdefghijklmnop'}});
 await api('/__email-test-control',{body:{mode:{smtp:'auth'}}});
 const before=(await api('/__outbox')).length;
 const email='book-now-customer@example.com';await api('/api/v1/auth/forgot-password',{body:{email}});
 const messages=await api('/__outbox');assert.equal(messages.length,before+1);
 const otp=messages.at(-1).html.match(/class="otp">(\d{6})</)[1];
 const verified=await api('/api/v1/auth/verify-reset-otp',{body:{email,otp}});
 await api('/api/v1/auth/reset-password',{body:{resetToken:verified.data.resetToken,newPassword:'NewStrongPassword123!'}});
 assert.equal((await api('/__outbox')).length,before+2,'Both security emails use platform transport');
 assert.equal((await api('/__email-test-control',{body:{}})).smtp.length,0,'No merchant SMTP connection was attempted');
 assert.equal((await api('/__business-email-test',{body:{}})).jobs.length,0);
});
