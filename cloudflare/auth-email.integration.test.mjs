import test from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './test-support/public-worker.mjs';
const email = 'book-now-customer@example.com';
async function fixture(t) {
  const ctx = await setup(t,'true','false');
  const {api,ownerToken}=ctx;
  const control=body=>api('/__email-test-control',{body});
  const {brandId}=await control({});
  const root='/api/v1/brand-email-settings/'+brandId;
  const owner=(path,options={})=>api(path,{...options,roleToken:ownerToken});
  const configure=async()=>{
    await owner(root,{method:'PUT',body:{provider:'GMAIL',fromName:'Synthetic merchant',fromEmail:'salon@gmail.com',smtpUsername:'salon@gmail.com',password:'abcdefghijklmnop'}});
    await owner(root+'/test-email',{body:{recipientEmail:'synthetic@example.com'}});
    await owner(root+'/enable',{method:'PATCH'});
    const status=(await owner(root)).data;assert.equal(status.sendingStatus,'READY');
    assert.doesNotMatch(JSON.stringify(status),/encryptedCredential|oauthDataEncrypted|abcdefghijklmnop/);
  };
  const forgot=(body={email},status=200)=>api('/api/v1/auth/forgot-password',{body,status});
  const verify=(otp,status=200,extra={})=>api('/api/v1/auth/verify-reset-otp',{body:{email,otp,...extra},status});
  const jobs=async()=>(await api('/__business-email-test',{body:{}})).jobs;
  return {...ctx,control,brandId,root,owner,configure,forgot,verify,jobs};
}
test('OTP and password reset use merchant transport, scoped tokens, TTL/cooldown/attempt controls and metadata-only history',async t=>{
  const {api,control,configure,forgot,verify,jobs}=await fixture(t);await configure();
  const platform=(await api('/__outbox')).length;
  const result=await forgot();assert.doesNotMatch(result.message,/OTP sent/i);
  const auth=(await control({})).auth;assert.ok(/^\d{6}$/.test(auth.otp));assert.ok(auth.ttl>0&&auth.ttl<=300);
  await forgot({email},429);
  const verified=await verify(auth.otp);
  await api('/api/v1/auth/reset-password',{body:{resetToken:verified.data.resetToken,newPassword:'NewStrongPassword123!'}});
  await api('/api/v1/auth/reset-password',{body:{resetToken:verified.data.resetToken,newPassword:'AnotherPassword123!'},status:400});
  const history=await jobs();assert.equal(history.filter(j=>j.eventType.startsWith('AUTH_')&&j.status==='SENT').length,2);
  assert.ok(history.every(j=>j.html===''&&j.text===null));
  assert.equal((await api('/__outbox')).length,platform);
  assert.equal((await control({})).smtp.length,3,'One configuration test and two security emails');
  await control({resetAuth:true});await forgot();
  const code=(await control({})).auth.otp;
  const wrong=code==='111111'?'222222':'111111';
  for(let i=0;i<5;i++)await verify(wrong,i===4?429:400);
  await verify(code,400);await control({resetAuth:true});await forgot();
  const expiring=(await control({})).auth.otp;await control({expireAuthOtp:true});await verify(expiring,400);
});
test('public reset response does not enumerate accounts; wrong and ambiguous brand context never send',async t=>{
  const {api,control,configure,forgot}=await fixture(t);await configure();
  const before=(await control({})).smtp.length;
  const absent=await forgot({email:'absent@example.com'});
  const wrong=await forgot({email,brandId:'11111111-1111-4111-8111-111111111111'});
  await control({addBrand:true});const ambiguous=await forgot();await control({removeBrand:true});
  assert.deepEqual(wrong,absent);assert.deepEqual(ambiguous,absent);
  assert.equal((await control({})).smtp.length,before);
  assert.equal((await control({})).auth.otp,null);
  assert.equal((await api('/__outbox')).length,0);
});
test('missing, disabled and unverified merchant configuration never produce an accepted OTP or platform fallback',async t=>{
  const {api,control,configure,forgot,jobs,owner,root}=await fixture(t);
  await forgot();assert.equal((await jobs()).at(-1).lastError,'EMAIL_NOT_CONFIGURED');
  await control({resetAuth:true});await configure();
  await owner(root+'/disable',{method:'PATCH'});
  const before=(await control({})).smtp.length;
  await forgot();assert.equal((await jobs()).at(-1).lastError,'EMAIL_DISABLED');
  await control({resetAuth:true,flags:{isEnabled:true,isVerified:false}});
  await forgot();assert.equal((await jobs()).at(-1).lastError,'EMAIL_NOT_VERIFIED');
  assert.equal((await control({})).smtp.length,before);assert.equal((await control({})).auth.otp,null);
  assert.equal((await api('/__outbox')).length,0);
});
test('SMTP authentication/network/uncertain failures never leave a newly valid OTP or retry automatically',async t=>{
  const {api,control,configure,forgot,jobs,cron}=await fixture(t);await configure();
  for(const [mode,status] of [['connect','FAILED'],['uncertain','DELIVERY_UNCERTAIN'],['auth','FAILED']]){
    await control({resetAuth:true,mode:{smtp:mode},flags:{isEnabled:true,isVerified:true}});
    await forgot();const job=(await jobs()).at(-1);assert.equal(job.status,status);assert.equal((await control({})).auth.otp,null);
    const attempts=(await control({})).smtp.length;await cron();assert.equal((await control({})).smtp.length,attempts);
  }
  assert.equal((await api('/__outbox')).length,0);
});
test('reset-success email failure preserves the completed password change and records failure without fallback',async t=>{
  const {api,control,configure,forgot,verify,jobs}=await fixture(t);await configure();await forgot();
  const verified=await verify((await control({})).auth.otp);await control({mode:{smtp:'connect'}});
  await api('/api/v1/auth/reset-password',{body:{resetToken:verified.data.resetToken,newPassword:'NewStrongPassword123!'}});
  await api('/api/v1/auth/login',{body:{email,password:'NewStrongPassword123!'}});
  assert.equal((await jobs()).find(j=>j.eventType==='AUTH_PASSWORD_RESET_SUCCESS').status,'FAILED');
  assert.equal((await api('/__outbox')).length,0);
});

test('crashed direct security sends become uncertain with the business flag false and are never replayed',async t=>{
 const {api,control,configure,forgot,jobs,cron}=await fixture(t);await configure();await forgot();
 const job=(await jobs()).find(j=>j.eventType==='AUTH_PASSWORD_RESET_OTP');
 await api('/__business-email-test',{body:{patch:{id:job.id,expired:true,data:{status:'SENDING'}}}});
 const before=(await control({})).smtp.length;await cron();await cron();
 assert.equal((await jobs()).find(j=>j.id===job.id).status,'DELIVERY_UNCERTAIN');
 assert.equal((await control({})).smtp.length,before);
});

test('the five-per-window limit survives cooldown expiry and missing merchant configuration',async t=>{
 const {control,forgot,jobs}=await fixture(t);
 for(let attempt=0;attempt<5;attempt++){
  await control({clearAuthCooldown:true});await forgot();
 }
 await control({clearAuthCooldown:true});await forgot({email},429);
 assert.equal((await jobs()).length,5);assert.equal((await control({})).auth.otp,null);
 assert.equal((await control({})).smtp.length,0);
});
