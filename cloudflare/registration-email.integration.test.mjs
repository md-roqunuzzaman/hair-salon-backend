import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { setup } from './test-support/public-worker.mjs';

const password='StrongPassword123!';
async function fixture(t,configured=true){
  const ctx=await setup(t,'true','false');
  const {api,ownerToken}=ctx;
  const control=body=>api('/__email-test-control',{body});
  const {brandId}=await control({});
  const root='/api/v1/brand-email-settings/'+brandId;
  if(configured){
    await api(root,{method:'PUT',roleToken:ownerToken,body:{provider:'GMAIL',fromName:'Synthetic merchant',fromEmail:'salon@gmail.com',smtpUsername:'salon@gmail.com',password:'abcdefghijklmnop'}});
    await api(root+'/test-email',{roleToken:ownerToken,body:{recipientEmail:'synthetic@example.com'}});
  }
  const register=(email,status=201)=>api('/api/v1/auth/register',{body:{name:'New <Customer>',email,password},status});
  const verify=(email,otp,status=200)=>api('/api/v1/auth/verify-email',{body:{email,otp},status});
  const resend=(email,status=200)=>api('/api/v1/auth/resend-verification-otp',{body:{email},status});
  const state=email=>control({authEmail:email});
  return {...ctx,control,root,register,verify,resend,state};
}

test('registration on Workers: Gmail OTP, hash/TTL, unverified gates, verify/login and replay protection',async t=>{
  const {api,register,verify,state,ownerToken,root}=await fixture(t);
  const email='registration@example.com';
  const user=(await register(email)).data;
  assert.equal(user.emailVerified,false);assert.equal(user.passwordHash,undefined);
  await api('/api/v1/auth/login',{body:{email,password},status:403});
  const token=jwt.sign({userId:user.id,email,role:'CUSTOMER'},'test-access-secret-'.repeat(3),{expiresIn:'5m'});
  await api('/api/v1/wallet',{roleToken:token,status:403});
  const before=await state(email),otp=before.verification.otp;
  assert.match(otp,/^\d{6}$/);assert.match(before.verification.hash,/^[a-f0-9]{64}$/);
  assert.notEqual(before.verification.hash,otp);assert.ok(before.verification.ttl>0&&before.verification.ttl<=300);
  const result=await verify(email,otp);assert.equal(result.data.emailVerified,true);
  assert.equal((await state(email)).verification.hash,null);
  assert.equal((await state(email)).verification.lock,null);
  await verify(email,otp,409);
  const login=await api('/api/v1/auth/login',{body:{email,password}});
  assert.equal(login.data.user.emailVerified,true);
  await api('/api/v1/wallet',{roleToken:login.data.accessToken});
  const jobs=await api(root+'/outbox?eventType=AUTH_EMAIL_VERIFICATION_OTP',{roleToken:ownerToken});
  assert.equal(jobs.data.length,1);assert.equal(jobs.data[0].status,'SENT');
  const raw=(await api('/__business-email-test',{body:{}})).jobs.find(j=>j.eventType==='AUTH_EMAIL_VERIFICATION_OTP');
  assert.equal(raw.html,'');assert.equal(raw.text,null);assert.doesNotMatch(JSON.stringify(jobs),new RegExp(otp));
});

test('verification on Workers: attempts, expiry, resend cooldown, replacement and concurrent replay',async t=>{
  const {register,verify,resend,state,control}=await fixture(t);
  const email='attempts@example.com';await register(email);
  const original=(await state(email)).verification.otp;
  const wrong=original==='111111'?'222222':'111111';
  for(let i=0;i<5;i++)await verify(email,wrong,i===4?429:400);
  await verify(email,original,400);assert.equal((await state(email)).verification.hash,null);
  await resend(email);await resend(email,429);
  const renewed=(await state(email)).verification.otp;
  assert.match(renewed,/^\d{6}$/);
  await control({authEmail:email,expireVerification:true});await verify(email,renewed,400);
  await control({authEmail:email,clearVerificationCooldown:true});await resend(email);
  const current=(await state(email)).verification.otp;
  await Promise.all([verify(email,current),verify(email,current,409)]);
  const sends=(await state(email)).smtp.length;
  await control({authEmail:email,clearVerificationCooldown:true});await resend(email);
  assert.equal((await state(email)).smtp.length,sends,'Verified customers do not receive another verification email');
});

test('registration delivery failures remain recoverable; uncertain security delivery is never retried by cron',async t=>{
  const {api,register,resend,state,control,verify,cron}=await fixture(t);
  const email='failure@example.com';
  await control({mode:{smtp:'uncertain'}});await register(email);
  let jobs=(await api('/__business-email-test',{body:{}})).jobs;
  const failed=jobs.find(j=>j.eventType==='AUTH_EMAIL_VERIFICATION_OTP');
  assert.equal(failed.status,'DELIVERY_UNCERTAIN');assert.equal(failed.attempts,1);
  const count=(await state(email)).smtp.length;await cron();assert.equal((await state(email)).smtp.length,count);
  await control({mode:{smtp:'connect'}});await resend(email);
  const preserved=(await state(email)).verification.hash;assert.ok(preserved);
  await control({mode:{},authEmail:email,clearVerificationCooldown:true});await resend(email);
  assert.notEqual((await state(email)).verification.hash,preserved);
  await verify(email,(await state(email)).verification.otp);
  jobs=(await api('/__business-email-test',{body:{}})).jobs;
  assert.equal(jobs.find(j=>j.id===failed.id).status,'DELIVERY_UNCERTAIN');
  await api('/__business-email-test',{body:{seed:{eventType:'AUTH_EMAIL_VERIFICATION_OTP',status:'SENDING',attempts:1,lockedUntil:new Date(0).toISOString(),validationData:{generation:'MERCHANT_AUTH_V1'}}}});
  const beforeRecovery=(await state(email)).smtp.length;
  await cron();
  const crashed=(await api('/__business-email-test',{body:{}})).jobs.at(-1);
  assert.equal(crashed.status,'DELIVERY_UNCERTAIN');
  assert.equal((await state(email)).smtp.length,beforeRecovery,'Crashed verification sends are quarantined without replay');
  assert.equal((await api('/__outbox')).length,0,'No platform fallback');
});

test('registration rate limits use per-client IP and normalized email; invalid OTP and unknown accounts fail safely',async t=>{
  const {api,verify,resend,state}=await fixture(t,false);
  await verify('absent@example.com','123456',400);
  await api('/api/v1/auth/verify-email',{body:{email:'absent@example.com',otp:'123'},status:400});
  await resend('absent@example.com');
  assert.equal((await state('absent@example.com')).smtp.length,0);
  await api('/api/v1/auth/register',{body:{name:'Missing edge IP',email:'no-ip@example.com',password},clientIp:'',status:400});
  for(let i=0;i<3;i++)await api('/api/v1/auth/register',{body:{name:'Existing',email:'book-now-customer@example.com',password},status:409,clientIp:`192.0.2.${20+i}`});
  await api('/api/v1/auth/register',{body:{name:'Existing',email:'BOOK-NOW-CUSTOMER@example.com',password},status:429,clientIp:'192.0.2.24'});
  for(let i=0;i<5;i++)await api('/api/v1/auth/register',{body:{name:'New customer',email:`rate-${i}@example.com`,password},clientIp:'192.0.2.99',status:201});
  await api('/api/v1/auth/register',{body:{name:'New customer',email:'rate-last@example.com',password},clientIp:'192.0.2.99',status:429});
});
