import test from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './test-support/public-worker.mjs';

test('business email: committed booking APIs, replay, reschedule, rollback, isolation and disabled cron', async t => {
  const { api, fixture, webhook, cron, ownerToken, managerToken } = await setup(t,'true');
  const inspect = body => api('/__business-email-test',{body:body || {}});
  const jobs = async () => (await inspect()).jobs;
  const {brandId} = await api('/__email-test-control',{body:{}});
  const root=`/api/v1/brand-email-settings/${brandId}/outbox`;
  await api(root,{roleToken:managerToken,status:403}); await api(root,{roleToken:'',status:401});
  await api('/api/v1/brand-email-settings/11111111-1111-4111-8111-111111111111/outbox',{roleToken:ownerToken,status:403});
  const book = async (method,time) => (await api(`/api/v1/appointments/${method}`,{body:{branchId:fixture.branchId,serviceId:fixture.serviceId,staffId:fixture.staffId,date:fixture.date,startTime:time},status:201})).data.appointmentId;
  const pay = async id => {
    const payment=(await api('/api/v1/payments/stripe/create-intent',{body:{appointmentId:id},status:201})).data;
    const event=await api('/__book-now-provider',{body:{paymentId:payment.paymentId}});
    await webhook(event); await webhook(event); await webhook({...event,id:event.id+'_replay'});
  };
  const payId=await book('pay-now','08:00'); assert.equal((await jobs()).length,0);
  await pay(payId); assert.equal((await jobs()).filter(j=>j.eventType==='PAY_NOW_CONFIRMED').length,1);
  const depositId=await book('deposit','09:00'); await pay(depositId);
  const deposit=(await jobs()).find(j=>j.eventType==='DEPOSIT_RECEIVED'); assert.match(deposit.text,/90\.00/);assert.match(deposit.text,/210\.00/);
  const reserved=await book('reserve','10:00');
  const reschedule=time=>api(`/api/v1/appointments/${reserved}/reschedule`,{body:{date:fixture.date,startTime:time,staffId:fixture.staffId}});
  await reschedule('11:00'); await reschedule('11:00'); await reschedule('12:00');
  const changes=(await jobs()).filter(j=>j.eventType==='BOOKING_RESCHEDULED');assert.equal(changes.length,2);assert.notEqual(changes[0].idempotencyKey,changes[1].idempotencyKey);assert.match(changes[0].text,/10:00/);assert.match(changes[0].text,/11:00/);
  await api(`/api/v1/appointments/${reserved}/reschedule`,{body:{date:fixture.date,startTime:'09:00',staffId:fixture.staffId},status:409});
  const beforeRollback=await jobs(); assert.equal((await inspect({rollback:reserved})).rolledBack,true);assert.deepEqual(await jobs(),beforeRollback);
  assert.equal((await inspect({badRefund:true})).emailEnqueued,false);assert.deepEqual(await jobs(),beforeRollback,'Mismatched payment and appointment customers cannot disclose refund data');
  await api(`/api/v1/appointments/${reserved}/cancel`,{body:{reason:'Synthetic cancellation'}});
  assert.equal((await jobs()).filter(j=>j.eventType==='BOOKING_CANCELLED').length,1);
  const beforeCron=await jobs();await cron();assert.deepEqual(await jobs(),beforeCron);assert.equal((await api('/__outbox')).length,0,'Disabled cron sends no business mail');
  const safe=(await api(root,{roleToken:ownerToken})).data;assert.ok(safe.length);assert.doesNotMatch(JSON.stringify(safe),/recipientEmail|html|claimToken|encryptedCredential/);
  await inspect({language:'zh-HK',invalidEmail:true}); const count=(await jobs()).length;
  await book('reserve','13:00');assert.equal((await jobs()).length,count,'Missing/invalid recipient cannot fail a committed booking');
});

test('business outbox: real SQLite claims, retries, uncertainty, leases, fencing, persistence failure and scheduler',async t=>{
  const {api,ownerToken,cron}=await setup(t,'true','true');
  const control=body=>api('/__business-email-test',{body});
  const mock=body=>api('/__email-test-control',{body});
  const {brandId}=await mock({}); const root=`/api/v1/brand-email-settings/${brandId}`;
  const owner=(url,options={})=>api(url,{...options,roleToken:ownerToken});
  await owner(root,{method:'PUT',body:{provider:'GMAIL',fromName:'Synthetic salon',fromEmail:'synthetic@gmail.com',smtpUsername:'synthetic@gmail.com',password:'abcdefghijklmnop'}});
  await owner(root+'/test-email',{body:{recipientEmail:'synthetic@example.com'}});await owner(root+'/enable',{method:'PATCH'});
  const seed=async()=> (await control({seed:{}})).id;
  const state=async id=>(await control({})).jobs.find(j=>j.id===id);
  let id=await seed();let sockets=(await mock({})).smtp.length;
  const concurrent=await control({one:id,concurrent:2});assert.equal(concurrent.filter(r=>r.processed).length,1);assert.equal((await mock({})).smtp.length,sockets+1);assert.equal((await state(id)).status,'SENT');
  await control({one:id});assert.equal((await mock({})).smtp.length,sockets+1);
  await mock({mode:{smtp:'connect'}});id=await seed();await control({one:id});let job=await state(id);assert.equal(job.status,'PENDING');assert.equal(job.attempts,1);assert.ok(new Date(job.nextAttemptAt)>new Date());
  await mock({mode:{}});await control({patch:{id,ready:true}});await control({one:id});assert.equal((await state(id)).status,'SENT');
  await mock({mode:{smtp:'connect'}});id=await seed();await control({one:id});
  await owner(root+'/disable',{method:'PATCH'});const noFallback=(await api('/__outbox')).length;
  await control({patch:{id,ready:true}});await control({one:id});assert.equal((await state(id)).lastError,'EMAIL_RETRY_PROVIDER_CHANGED');assert.equal((await state(id)).status,'FAILED');assert.equal((await api('/__outbox')).length,noFallback,'Later retries cannot switch a failed merchant attempt to platform');
  await owner(root+'/enable',{method:'PATCH'});
  await mock({mode:{smtp:'connect'}});id=await seed();
  for(let attempt=0;attempt<3;attempt++){await control({patch:{id,ready:true}});await control({one:id});}
  assert.equal((await state(id)).status,'FAILED');assert.equal((await state(id)).attempts,3);
  await mock({mode:{smtp:'reject'}});id=await seed();await control({one:id});assert.equal((await state(id)).status,'FAILED');assert.equal((await state(id)).lastError,'EMAIL_PROVIDER_REJECTED');
  await mock({mode:{smtp:'temporary'}});id=await seed();await control({one:id});assert.equal((await state(id)).status,'PENDING');assert.equal((await state(id)).lastError,'EMAIL_PROVIDER_TEMPORARY_FAILURE');
  await mock({mode:{smtp:'uncertain'}});id=await seed();const platform=(await api('/__outbox')).length;await control({one:id});assert.equal((await state(id)).status,'DELIVERY_UNCERTAIN');const count=(await mock({})).smtp.length;await control({one:id});assert.equal((await mock({})).smtp.length,count);assert.equal((await api('/__outbox')).length,platform);
  await mock({mode:{smtp:'auth'}});id=await seed();await control({one:id});assert.equal((await state(id)).status,'FAILED');
  await mock({mode:{}});await owner(root+'/test-email',{body:{recipientEmail:'synthetic@example.com'}});await owner(root+'/enable',{method:'PATCH'});
  const before=await seed();await control({patch:{id:before,data:{status:'PROCESSING',claimToken:'old-pre-send'},expired:true}});assert.equal((await control({recover:true})).recovered,1);await control({one:before});assert.equal((await state(before)).status,'SENT');
  const abandoned=await seed();await control({patch:{id:abandoned,data:{status:'SENDING',claimToken:'old-send'},expired:true}});assert.equal((await control({recover:true})).uncertain,1);await control({one:abandoned});assert.equal((await state(abandoned)).status,'DELIVERY_UNCERTAIN');
  id=await seed();await control({stealDuringSend:id});await control({one:id});assert.equal((await state(id)).status,'DELIVERY_UNCERTAIN','Stale sender cannot mark recovered job SENT');
  id=await seed();await control({failFinalize:true});await control({one:id});assert.equal((await state(id)).status,'DELIVERY_UNCERTAIN','Accepted send with failed persistence is never replayed');await control({failFinalize:false});
  id=await seed();await owner(root+'/disable',{method:'PATCH'});sockets=(await mock({})).smtp.length;await cron();assert.equal((await state(id)).status,'SENT');assert.equal((await state(id)).provider,'PLATFORM_SMTP');assert.equal((await mock({})).smtp.length,sockets,'Disabled provider resolves to platform before attempt');
  id=await seed();
  await owner(root,{method:'PUT',body:{provider:'QQ',fromName:'Synthetic salon',fromEmail:'synthetic@qq.com',smtpUsername:'synthetic@qq.com',password:'synthetic-authorization-code'}});
  await owner(root+'/test-email',{body:{recipientEmail:'synthetic@example.com'}});await owner(root+'/enable',{method:'PATCH'});
  await control({one:id});assert.equal((await state(id)).provider,'QQ');assert.equal((await mock({})).smtp.at(-1).host,'smtp.qq.com','Queued job resolves the current verified provider');
});

test('outbox rejects an invalid recipient, unknown brand and unapproved event before transport',async t=>{
  const {api}=await setup(t,'true','true');const control=body=>api('/__business-email-test',{body});
  for(const [seed,code]of [[{recipientEmail:'invalid-recipient'},'EMAIL_RECIPIENT_INVALID'],[{brandId:'11111111-1111-4111-8111-111111111111'},'EMAIL_BRAND_CONTEXT_INVALID'],[{eventType:'APPOINTMENT_REMINDER'},'EMAIL_EVENT_NOT_APPROVED']]){
    const {id}=await control({seed});await control({one:id});const job=(await control({})).jobs.find(j=>j.id===id);assert.equal(job.status,'FAILED');assert.equal(job.lastError,code);
  }
  assert.equal((await api('/__outbox')).length,0);
});

for(const [language,word]of [['en','Booking reserved'],['zh-CN','预约已保留'],['zh-HK','預約已保留']])test(`business email template ${language} uses recipient preference and escapes content`,async t=>{
  const {api,fixture}=await setup(t,'true');await api('/__business-email-test',{body:{language}});
  await api('/api/v1/appointments/reserve',{body:{branchId:fixture.branchId,serviceId:fixture.serviceId,date:fixture.date,startTime:'15:00'},status:201});
  const job=(await api('/__business-email-test',{body:{}})).jobs[0];assert.match(job.subject,new RegExp(word));assert.match(job.html,/&lt;script&gt;&amp;/);assert.doesNotMatch(job.html,/<script>/);assert.match(job.text,/Asia\/Hong_Kong/);assert.ok(job.text.includes(fixture.date));
  if(language==='zh-CN')assert.match(job.text,/简体剪发/);if(language==='zh-HK')assert.match(job.text,/繁體剪髮/);
});
