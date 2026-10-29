import test from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './test-support/public-worker.mjs';

async function merchantFixture(t, flag = 'true') {
 const ctx=await setup(t,'true',flag),{api,ownerToken,fixture}=ctx;
 const provider=body=>api('/__email-test-control',{body});
 const {brandId}=await provider({});
 const root='/api/v1/brand-email-settings/'+brandId;
 const owner=(path,options={})=>api(path,{...options,roleToken:ownerToken});
 await owner(root,{method:'PUT',body:{provider:'GMAIL',fromName:'Synthetic merchant',fromEmail:'salon@gmail.com',smtpUsername:'salon@gmail.com',password:'abcdefghijklmnop'}});
 await owner(root+'/test-email',{body:{recipientEmail:'synthetic@example.com'}});
 await owner(root+'/enable',{method:'PATCH'});
 const control=body=>api('/__business-email-test',{body});
 const jobs=async()=>(await control({})).jobs;
 const book=async(method,time)=>(await api('/api/v1/appointments/'+method,{body:{branchId:fixture.branchId,serviceId:fixture.serviceId,staffId:fixture.staffId,date:fixture.date,startTime:time},status:201})).data.appointmentId;
 return {...ctx,root,owner,provider,control,jobs,book};
}

test('all seven merchant events reconcile after commit; signed webhook replay and repeated scans do not duplicate',async t=>{
 const{api,fixture,state,webhook,control,jobs,book,ownerToken}=await merchantFixture(t);
 const pay=async id=>{
  const payment=(await api('/api/v1/payments/stripe/create-intent',{body:{appointmentId:id},status:201})).data;
  const event=await api('/__book-now-provider',{body:{paymentId:payment.paymentId}});
  await webhook(event);await webhook(event);await webhook({...event,id:event.id+'_replay'});
 };
 const paid=await book('pay-now','08:00');assert.equal((await jobs()).length,0);await pay(paid);
 await pay(await book('deposit','09:00'));
 const reserved=await book('reserve','10:00');
 await control({collect:true});assert.equal((await jobs()).length,3);
 await control({batch:10});assert.ok((await jobs()).every(j=>j.status==='SENT'));
 for(const time of ['11:00','11:00'])await api('/api/v1/appointments/'+reserved+'/reschedule',{body:{date:fixture.date,startTime:time,staffId:fixture.staffId}});
 await control({batch:10});assert.equal((await jobs()).filter(j=>j.eventType==='BOOKING_RESCHEDULED').length,1);
 await api('/api/v1/appointments/'+reserved+'/cancel',{body:{reason:'Synthetic cancellation'}});
 const wallet=await book('pay-now','14:00');await api('/api/v1/appointments/'+wallet+'/pay-with-wallet',{body:{useBonus:true}});
 const payment=(await state()).payments.find(p=>p.appointmentId===wallet);
 const request=(await api('/api/v1/refund-requests',{body:{paymentId:payment.id,reason:'Synthetic unused appointment refund'},status:201})).data;
 await api('/api/v1/refund-requests/'+request.id+'/review',{method:'PATCH',body:{decision:'APPROVE'},roleToken:ownerToken});
 await api('/api/v1/refund-requests/'+request.id+'/process',{body:{},roleToken:ownerToken});
 const refund=(await state()).refunds.find(r=>r.paymentId===payment.id);
 const purchase=(await api('/api/v1/group-purchases',{body:{packageId:fixture.packageId,quantity:1},status:201})).data;
 await api('/api/v1/group-purchases/'+purchase.purchaseId+'/pay-with-wallet',{body:{useBonus:true}});
 for(let i=0;i<4;i++)await control({batch:10});
 const before=await jobs();
 assert.deepEqual([...new Set(before.map(j=>j.eventType))].sort(),['PAY_NOW_CONFIRMED','RESERVE_NOW_RESERVED','DEPOSIT_RECEIVED','GROUP_PURCHASE_SUCCESSFUL','BOOKING_CANCELLED','BOOKING_RESCHEDULED','REFUND_COMPLETED'].sort());
 assert.ok(before.every(j=>j.status==='SENT'));
 assert.equal(new Set(before.map(j=>j.idempotencyKey)).size,before.length);
 await control({refund:refund.id});await control({collect:true});await control({collect:true});
 assert.deepEqual(await jobs(),before);
 assert.equal((await api('/__outbox')).length,0,'No platform email ever sent');
});

test('legacy jobs stay untouched; processor is fenced, transient retries are bounded and uncertain deliveries never replay',async t=>{
 const{api,control,jobs,book,provider}=await merchantFixture(t);
 const legacy=[];
 for(const status of ['PENDING','PROCESSING','SENDING','DELIVERY_UNCERTAIN','SKIPPED','SENT'])legacy.push((await control({seed:{status,lockedUntil:new Date(0).toISOString(),attempts:1}})).id);
 const old=(await jobs()).filter(j=>legacy.includes(j.id));
 await control({batch:10});
 assert.deepEqual((await jobs()).filter(j=>legacy.includes(j.id)),old);
 const reserve=async time=>{const id=await book('reserve',time);await control({collect:true});await control({collect:true});return(await jobs()).find(j=>j.appointmentId===id);};
 let job=await reserve('10:00');await provider({mode:{smtp:'connect'}});
 let result=await control({one:job.id});assert.equal(result[0].status,'PENDING');
 assert.equal((await jobs()).find(j=>j.id===job.id).attempts,1);
 await provider({mode:{}});await control({patch:{id:job.id,ready:true}});
 result=await control({one:job.id,concurrent:2});assert.equal(result.filter(r=>r.processed).length,1);
 assert.equal((await jobs()).find(j=>j.id===job.id).attempts,2);
 job=await reserve('11:00');await provider({mode:{smtp:'uncertain'}});
 assert.equal((await control({one:job.id}))[0].status,'DELIVERY_UNCERTAIN');
 const sockets=(await provider({})).smtp.length;
 await control({one:job.id});await control({recover:true});assert.equal((await provider({})).smtp.length,sockets);
 await provider({mode:{}});
 job=await reserve('12:00');await control({failFinalize:true});
 assert.equal((await control({one:job.id}))[0].status,'DELIVERY_UNCERTAIN');
 await control({failFinalize:false});assert.equal((await jobs()).find(j=>j.id===job.id).lastError,'EMAIL_ACCEPTED_HISTORY_UNCERTAIN');
 job=await reserve('13:00');await provider({mode:{smtp:'reject'}});
 assert.equal((await control({one:job.id}))[0].status,'FAILED');
 assert.equal((await api('/__outbox')).length,0);
});

test('stale reservations/reschedules skip; failed email storage cannot roll back business or in-app notifications',async t=>{
 const{api,fixture,control,jobs,book,provider,state}=await merchantFixture(t,'false');
 await control({failEmailStorage:true});const id=await book('reserve','10:00');
 const committed=await state();await control({collect:true});
 assert.deepEqual(await state(),committed);assert.equal((await jobs()).length,0);
 await control({failEmailStorage:false});await control({failSettingRead:true});
 await control({collect:true});assert.equal((await jobs()).length,0,'A configuration storage outage must not permanently skip the source');
 await control({failSettingRead:false});await control({collect:true});await control({collect:true});
 assert.equal((await jobs()).length,1);
 const original=(await jobs())[0];
 await api('/api/v1/appointments/'+id+'/reschedule',{body:{date:fixture.date,startTime:'11:00',staffId:fixture.staffId}});
 await control({collect:true});await control({collect:true});
 const reschedule=(await jobs()).find(j=>j.eventType==='BOOKING_RESCHEDULED');assert.ok(reschedule);
 // Explicitly disabled delivery leaves current jobs pending without network I/O.
 const before=(await provider({})).smtp.length;await control({batch:10});
 assert.equal((await provider({})).smtp.length,before);
 const audit=await api('/api/v1/brand-email-settings/'+original.brandId+'/outbox/audit',{roleToken:(await api('/api/v1/auth/login',{body:{email:'owner@example.com',password:'OwnerPassword123!'}})).data.accessToken});
 assert.equal(audit.data.find(j=>j.id===original.id).audit.disposition,'STALE');
 assert.equal(audit.data.find(j=>j.id===reschedule.id).audit.disposition,'ELIGIBLE');
 assert.equal((await api('/__outbox')).length,0);
});

test('missing configuration records skipped events; configuring later never revives old skipped records',async t=>{
 const{api,fixture,ownerToken}=await setup(t,'true','false');
 const provider=body=>api('/__email-test-control',{body}),control=body=>api('/__business-email-test',{body});
 const{brandId}=await provider({});
 await api('/api/v1/appointments/reserve',{body:{branchId:fixture.branchId,serviceId:fixture.serviceId,date:fixture.date,startTime:'10:00'},status:201});
 await control({collect:true});let jobs=(await control({})).jobs;assert.equal(jobs.length,1);
 assert.equal(jobs[0].status,'SKIPPED');assert.equal(jobs[0].lastError,'EMAIL_NOT_CONFIGURED');
 await api('/api/v1/brand-email-settings/'+brandId,{method:'PUT',roleToken:ownerToken,body:{provider:'GMAIL',fromName:'Synthetic',fromEmail:'salon@gmail.com',smtpUsername:'salon@gmail.com',password:'abcdefghijklmnop'}});
 await control({collect:true});await control({collect:true});
 assert.deepEqual((await control({})).jobs,jobs);assert.equal((await provider({})).smtp.length,0);
});

test('SMTP 451 exhausts a bounded retry budget; expired leases and stale senders cannot duplicate delivery',async t=>{
 const{control,jobs,book,provider}=await merchantFixture(t);
 const reserve=async time=>{const id=await book('reserve',time);await control({collect:true});await control({collect:true});return(await jobs()).find(j=>j.appointmentId===id);};
 let job=await reserve('09:00');await provider({mode:{smtp:'temporary'}});
 for(let attempt=1;attempt<=3;attempt++){
  await control({patch:{id:job.id,ready:true}});
  assert.equal((await control({one:job.id}))[0].status,attempt===3?'FAILED':'PENDING');
  assert.equal((await jobs()).find(j=>j.id===job.id).attempts,attempt);
 }
 const failedCount=(await provider({})).smtp.length;await control({one:job.id});assert.equal((await provider({})).smtp.length,failedCount);
 await provider({mode:{}});job=await reserve('10:00');
 await control({patch:{id:job.id,expired:true,data:{status:'PROCESSING',claimToken:'abandoned'}}});
 assert.equal((await control({recover:true})).recovered,1);
 assert.equal((await control({one:job.id}))[0].status,'SENT');
 job=await reserve('11:00');await control({patch:{id:job.id,expired:true,data:{status:'SENDING',claimToken:'abandoned'}}});
 assert.equal((await control({recover:true})).uncertain,1);
 const before=(await provider({})).smtp.length;await control({one:job.id});assert.equal((await provider({})).smtp.length,before);
 job=await reserve('12:00');await control({stealDuringSend:job.id});await control({one:job.id});
 assert.equal((await jobs()).find(j=>j.id===job.id).status,'DELIVERY_UNCERTAIN');
 const after=(await provider({})).smtp.length;await control({batch:10});assert.equal((await provider({})).smtp.length,after);
});

test('delivery-time freshness, financial history, provider pinning and isolated scheduled processing',async t=>{
 const{api,fixture,root,owner,control,jobs,book,provider,scheduled,direct}=await merchantFixture(t);
 const reservation=await book('reserve','09:00');await control({collect:true});
 await api('/api/v1/appointments/'+reservation+'/reschedule',{body:{date:fixture.date,startTime:'10:00',staffId:fixture.staffId}});
 await control({collect:true});await control({collect:true});
 const stale=(await jobs()).find(j=>j.appointmentId===reservation&&j.eventType==='RESERVE_NOW_RESERVED');
 assert.equal((await control({one:stale.id}))[0].status,'SKIPPED');
 assert.equal((await jobs()).find(j=>j.id===stale.id).skipReason,'EMAIL_BOOKING_OUTDATED');
 const paid=await book('pay-now','11:00');await api('/api/v1/appointments/'+paid+'/pay-with-wallet',{body:{useBonus:true}});
 await api('/api/v1/appointments/'+paid+'/reschedule',{body:{date:fixture.date,startTime:'12:00',staffId:fixture.staffId}});
 await control({collect:true});await control({collect:true});
 const receipt=(await jobs()).find(j=>j.appointmentId===paid&&j.eventType==='PAY_NOW_CONFIRMED');
 assert.equal((await control({one:receipt.id}))[0].status,'SENT','Historical payment remains eligible after a schedule change');
 assert.equal((await direct('/__email-cron-failure',{})).cronStatus,500);
 assert.ok((await direct('/__business-email-test',{})).jobs.filter(j=>j.eventType==='BOOKING_RESCHEDULED').every(j=>j.status==='SENT'),'Email continues when an unrelated cron task fails');
 await scheduled();
 const next=await book('reserve','13:00');await control({collect:true});await control({collect:true});
 const pinned=(await jobs()).find(j=>j.appointmentId===next);await provider({mode:{smtp:'connect'}});
 assert.equal((await control({one:pinned.id}))[0].status,'PENDING');await provider({mode:{}});
 await owner(root,{method:'PUT',body:{provider:'QQ',fromName:'Synthetic QQ',fromEmail:'synthetic@qq.com',smtpUsername:'synthetic@qq.com',password:'synthetic-auth-code'}});
 await owner(root+'/test-email',{body:{recipientEmail:'synthetic@example.com'}});await owner(root+'/enable',{method:'PATCH'});
 await control({patch:{id:pinned.id,ready:true}});const count=(await provider({})).smtp.length;
 assert.equal((await control({one:pinned.id}))[0].code,'EMAIL_RETRY_PROVIDER_CHANGED');
 assert.equal((await provider({})).smtp.length,count);assert.equal((await api('/__outbox')).length,0);
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
  const audit=await owner(root+'/audit?status=PENDING');assert.equal(audit.summary.statusCounts.PENDING,3);assert.ok(audit.data.every(j=>j.audit.disposition==='BLOCKED'));
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
