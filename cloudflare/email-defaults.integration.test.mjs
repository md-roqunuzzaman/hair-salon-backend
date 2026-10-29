import test from 'node:test';
import assert from 'node:assert/strict';
import {setup} from './test-support/public-worker.mjs';

test('real Worker configuration APIs separate default enablement from verification and manual disable',async t=>{
 for(const provider of ['GMAIL','QQ','NETEASE_163','CUSTOM_SMTP'])await t.test(provider,async t=>{
  const {api,ownerToken}=await setup(t,'true','false');
  const control=body=>api('/__email-test-control',{body});
  const {brandId}=await control({});const root='/api/v1/brand-email-settings/'+brandId;
  const owner=(url,options={})=>api(url,{...options,roleToken:ownerToken});
  const read=()=>owner(root);const save=body=>owner(root,{method:'PUT',body});
  const direct=(status=200)=>owner(root+'/test-email',{body:{recipientEmail:'synthetic@example.com'},status});
  const address=provider==='GMAIL'?'salon@gmail.com':provider==='QQ'?'salon@qq.com':provider==='NETEASE_163'?'salon@163.com':'sender@example.com';
  const data={provider,fromName:'Synthetic',fromEmail:address,smtpUsername:address,password:provider==='GMAIL'?'abcd efgh ijkl mnop':'synthetic-code',...(provider==='CUSTOM_SMTP'?{smtpHost:'mail.example.com',smtpPort:465,smtpSecure:true}:{})};
  assert.deepEqual((await read()).data.defaults,{isEnabled:true,isVerified:false});
  await owner(root,{method:'PUT',body:{...data,isVerified:true},status:400});
  await owner(root,{method:'PUT',body:{...data,isEnabled:false},status:400});
  let saved=(await save(data)).data;assert.equal(saved.isEnabled,true);assert.equal(saved.isVerified,false);
  assert.equal((await read()).data.sendingStatus,'EMAIL_NOT_VERIFIED');
  await owner(root+'/test-business-email',{body:{to:'synthetic@example.com'},status:422});
  assert.equal((await control({})).smtp.length,0,'Unverified sending cannot open an SMTP socket');
  if(provider==='CUSTOM_SMTP'){
   assert.equal((await direct(422)).message,'EMAIL_CUSTOM_SMTP_REQUIRES_NODE_DELIVERY');
   const state=(await read()).data;assert.equal(state.setting.isEnabled,true);assert.equal(state.setting.isVerified,false);assert.equal(state.runtimeCapabilities.customSmtp,false);
   return;
  }
  await control({mode:{smtp:'auth'}});await direct(422);
  let state=(await read()).data;assert.equal(state.setting.isEnabled,true);assert.equal(state.setting.isVerified,false);
  await control({mode:{}});const verified=(await direct()).data;
  assert.equal(verified.isEnabled,true);assert.equal(verified.isVerified,true);assert.equal(verified.sendingStatus,'READY');
  assert.equal((await read()).data.sendingStatus,'READY');
  await owner(root+'/test-business-email',{body:{to:'synthetic@example.com'}});
  const testedAt=(await read()).data.setting.lastTestAt;
  const {password:omitted,...cosmetic}=data;
  saved=(await save({...cosmetic,fromName:'Changed cosmetic name'})).data;
  assert.equal(saved.isVerified,true);assert.equal(saved.isEnabled,true);assert.equal(saved.lastTestAt,testedAt);
  await owner(root+'/disable',{method:'PATCH'});
  saved=(await save({...data,fromName:'Still disabled, same password'})).data;
  assert.equal(saved.isEnabled,false);assert.equal(saved.isVerified,true);
  const disabledTest=(await direct()).data;assert.equal(disabledTest.isEnabled,false);assert.equal(disabledTest.isVerified,true);assert.equal(disabledTest.sendingStatus,'EMAIL_DISABLED');
  const count=(await control({})).smtp.length;await owner(root+'/test-business-email',{body:{to:'synthetic@example.com'},status:422});assert.equal((await control({})).smtp.length,count);
  saved=(await save({...data,password:provider==='GMAIL'?'ponmlkjihgfedcba':'rotated-code'})).data;
  assert.equal(saved.isEnabled,false);assert.equal(saved.isVerified,false);
  await direct();assert.equal((await read()).data.setting.isEnabled,false);
  await owner(root+'/enable',{method:'PATCH'});assert.equal((await read()).data.sendingStatus,'READY');
  assert.equal((await api('/__outbox')).length,0,'Never falls back to platform');
 });
});
