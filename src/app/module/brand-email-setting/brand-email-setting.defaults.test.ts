import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import dns from 'node:dns/promises';
import { syncBuiltinESMExports } from 'node:module';
import nodemailer from 'nodemailer';
import { prisma } from '../../lib/prisma.js';
import { saveBrandEmailSetting, getBrandEmailSetting, disableBrandEmailSetting, enableBrandEmailSetting } from './brand-email-setting.service.js';
import { sendBrandTestEmail } from './brand-email-setting.test-email.js';
import { resolveBusinessEmailDelivery } from './brand-email-setting.sender.js';

// Storage and SMTP are mocked; execute the real Node services and four adapters
// without connecting to PostgreSQL, DNS, SMTP or any external email provider.
test('SMTP configuration defaults, cosmetic edits, verification and explicit owner intent', async t => {
 const brandId='11111111-1111-4111-8111-111111111111';
 const key=process.env.EMAIL_ENCRYPTION_KEY;process.env.EMAIL_ENCRYPTION_KEY='cd'.repeat(32);
 let row:any=null,mode='ok',sends=0,onSend:(()=>Promise<void>)|undefined;
 // Prisma delegates expose virtual method descriptors. Assign explicit stubs
 // rather than Node's descriptor-based mock.method for those delegates.
 const stubMethod=(target:any,name:string,implementation:Function)=>{const original=target[name];target[name]=implementation;return {mock:{restore:()=>{target[name]=original;}}};};
 const selected=(value:any,select:any)=>!value?null:select?Object.fromEntries(Object.keys(select).filter(k=>select[k]).map(k=>[k,value[k]])):{...value};
 const mocks=[
  stubMethod(prisma.brand,'findUnique',async()=>({id:brandId})),
  stubMethod(prisma.brand,'findMany',async()=>[{id:brandId}]),
  stubMethod(prisma.brandEmailSetting,'findUnique',async(args:any)=>selected(row,args.select)),
  stubMethod(prisma.brandEmailSetting,'create',async(args:any)=>{
   row={id:'22222222-2222-4222-8222-222222222222',configurationVersion:1,createdAt:new Date(),updatedAt:new Date(),isVerified:false,oauthDataEncrypted:null,providerData:null,lastTestAt:null,lastErrorCode:null,...args.data};
   return selected(row,args.select);
  }),
  stubMethod(prisma.brandEmailSetting,'updateMany',async(args:any)=>{
   if(!row||args.where.id!==row.id||args.where.configurationVersion!==row.configurationVersion||(args.where.isVerified!==undefined&&args.where.isVerified!==row.isVerified)||(args.where.isEnabled!==undefined&&args.where.isEnabled!==row.isEnabled))return {count:0};
   const data={...args.data};if(typeof data.configurationVersion==='object')data.configurationVersion=row.configurationVersion+data.configurationVersion.increment;
   row={...row,...data};return {count:1};
  }),
  mock.method(dns,'lookup',async()=>[{address:'8.8.8.8',family:4}]),
  mock.method(nodemailer,'createTransport',()=>({async sendMail(){sends++;if(onSend){const callback=onSend;onSend=undefined;await callback();}if(mode==='auth')throw Object.assign(new Error('private SMTP reply'),{code:'EAUTH',responseCode:535});return {messageId:'synthetic-accepted',accepted:['recipient@example.com']};},close(){}})),
 ];
 syncBuiltinESMExports();
 try {
  for(const provider of ['GMAIL','QQ','NETEASE_163','CUSTOM_SMTP'] as const)await t.test(provider,async()=>{
   row=null;mode='ok';sends=0;
   const password=provider==='GMAIL'?'abcdefghijklmnop':'synthetic-authorization-code';
   const address=provider==='GMAIL'?'salon@gmail.com':provider==='QQ'?'salon@qq.com':provider==='NETEASE_163'?'salon@163.com':'sender@example.com';
   const payload:any={provider,fromName:'Original',fromEmail:address,smtpUsername:address,password,...(provider==='CUSTOM_SMTP'?{smtpHost:'mail.example.com',smtpPort:465,smtpSecure:true}:{})};
   const metadata=await getBrandEmailSetting(brandId);assert.deepEqual(metadata.defaults,{isEnabled:true,isVerified:false});
   await assert.rejects(saveBrandEmailSetting(brandId,{...payload,isVerified:true}),(e:any)=>e.statusCode===400);
   await assert.rejects(saveBrandEmailSetting(brandId,{...payload,isEnabled:false}),(e:any)=>e.statusCode===400);
   let saved=await saveBrandEmailSetting(brandId,payload);assert.equal(saved!.isEnabled,true);assert.equal(saved!.isVerified,false);
   assert.equal((await getBrandEmailSetting(brandId)).sendingStatus,'EMAIL_NOT_VERIFIED');
   const message={brandId,to:'recipient@example.com',subject:'Synthetic'};
   await assert.rejects(resolveBusinessEmailDelivery(message),(e:any)=>e.code==='EMAIL_NOT_VERIFIED');assert.equal(sends,0);
   mode='auth';await assert.rejects(sendBrandTestEmail(brandId,message.to));assert.equal(row.isEnabled,true);assert.equal(row.isVerified,false);
   mode='ok';const verified=await sendBrandTestEmail(brandId,message.to);assert.equal(verified.sendingStatus,'READY');assert.equal(verified.isEnabled,true);
   assert.equal((await getBrandEmailSetting(brandId)).sendingStatus,'READY');await(await resolveBusinessEmailDelivery(message)).send();
   const testAt=row.lastTestAt;const {password:omitted,...cosmetic}=payload;
   saved=await saveBrandEmailSetting(brandId,{...cosmetic,fromName:'Cosmetic name'});assert.equal(saved!.isVerified,true);assert.equal(saved!.isEnabled,true);assert.equal(row.lastTestAt,testAt);
   saved=await saveBrandEmailSetting(brandId,{...payload,fromName:'Cosmetic plus same credential'});assert.equal(saved!.isVerified,true,'Unchanged normalized credential must retain verification');
   saved=await saveBrandEmailSetting(brandId,{...payload,password:provider==='GMAIL'?'ponmlkjihgfedcba':'rotated-authorization-code'});assert.equal(saved!.isVerified,false);assert.equal(saved!.isEnabled,true);
   await sendBrandTestEmail(brandId,message.to);
   mode='auth';await assert.rejects((await resolveBusinessEmailDelivery(message)).send());assert.equal(row.isEnabled,true);assert.equal(row.isVerified,false,'Authorization failures block sends without changing owner intent');
   mode='ok';await sendBrandTestEmail(brandId,message.to);await disableBrandEmailSetting(brandId);
   saved=await saveBrandEmailSetting(brandId,{...cosmetic,fromName:'Disabled cosmetic'});assert.equal(saved!.isEnabled,false);assert.equal(saved!.isVerified,true);
   mode='auth';await assert.rejects(sendBrandTestEmail(brandId,message.to));assert.equal(row.isEnabled,false);assert.equal(row.isVerified,false);
   mode='ok';const disabledTest=await sendBrandTestEmail(brandId,message.to);assert.equal(disabledTest.isVerified,true);assert.equal(disabledTest.isEnabled,false);assert.equal(disabledTest.sendingStatus,'EMAIL_DISABLED');
   await assert.rejects(resolveBusinessEmailDelivery(message),(e:any)=>e.code==='EMAIL_DISABLED');
   saved=await saveBrandEmailSetting(brandId,{...payload,password:provider==='GMAIL'?'qrstuvwxyzabcdef':'new-credential'});assert.equal(saved!.isEnabled,false);assert.equal(saved!.isVerified,false);
   await sendBrandTestEmail(brandId,message.to);await enableBrandEmailSetting(brandId);assert.equal((await getBrandEmailSetting(brandId)).sendingStatus,'READY');
   onSend=async()=>{await disableBrandEmailSetting(brandId);};await assert.rejects(sendBrandTestEmail(brandId,message.to),(e:any)=>e.statusCode===409);assert.equal(row.isEnabled,false,'In-flight success cannot undo concurrent manual disable');
  });
 } finally {mocks.forEach(m=>m.mock.restore());syncBuiltinESMExports();if(key===undefined)delete process.env.EMAIL_ENCRYPTION_KEY;else process.env.EMAIL_ENCRYPTION_KEY=key;}
});
