import test from 'node:test';
import assert from 'node:assert/strict';
import nodemailer from 'nodemailer';
import { encryptEmailCredential, decryptEmailCredential } from '../../utils/email-credential-crypto.js';
import { isPublicSmtpIPv4, resolveCustomSmtp, sendMerchantSmtp } from '../../lib/merchant-smtp.js';
import { safeEmailError } from './brand-email-setting.errors.js';
import { emailProviderConfigurationSchema } from './brand-email-setting.validation.js';
import type { BrandEmailSetting } from '../../../../generated/prisma/client.js';
import { EMAIL_EVENTS, renderBusinessEmail, emailMoney, emailAppointmentTime } from './brand-email-setting.templates.js';

test('credential encryption roundtrip and authenticated tamper rejection', () => {
  const old = process.env.EMAIL_ENCRYPTION_KEY;
  process.env.EMAIL_ENCRYPTION_KEY = '12'.repeat(32);
  try {
    const first = encryptEmailCredential('synthetic-password');
    assert.notEqual(first, encryptEmailCredential('synthetic-password'));
    assert.equal(decryptEmailCredential(first), 'synthetic-password');
    const parts = first.split(':'); parts[2] = Buffer.alloc(16).toString('base64url');
    assert.throws(() => decryptEmailCredential(parts.join(':')));
    assert.throws(() => decryptEmailCredential('invalid'));
  } finally { if (old === undefined) delete process.env.EMAIL_ENCRYPTION_KEY; else process.env.EMAIL_ENCRYPTION_KEY = old; }
});
test('configuration rejects SMTP/header injection, unsafe literals and Microsoft passwords', () => {
  const common = { fromName: 'Salon', fromEmail: 'salon@example.com' };
  for (const provider of ['GMAIL','QQ','NETEASE_163']) assert.equal(emailProviderConfigurationSchema.safeParse({ ...common, provider, smtpUsername: common.fromEmail, password: 'test' }).success, true);
  assert.equal(emailProviderConfigurationSchema.safeParse({ ...common, provider: 'MICROSOFT_365', password: 'forbidden' }).success, false);
  for (const smtpHost of ['127.0.0.1','[::1]','localhost','169.254.169.254','smtp.example.com\r\nDATA']) {
    assert.equal(emailProviderConfigurationSchema.safeParse({ ...common, provider: 'CUSTOM_SMTP', smtpHost, smtpPort: 465, smtpSecure: true, smtpUsername: 'test', password: 'test' }).success, false);
  }
  assert.equal(emailProviderConfigurationSchema.safeParse({ ...common, fromName: 'bad\r\nheader', provider: 'RESEND', apiKey: 'test' }).success, false);
});
test('custom SMTP rejects all unsafe DNS answers and pins the public answer', async () => {
  for (const address of ['0.0.0.0','10.0.0.1','127.0.0.1','169.254.169.254','172.16.0.1','192.168.1.1','100.64.0.1','198.18.0.1','224.0.0.1','255.255.255.255','::1','::ffff:127.0.0.1','fc00::1','fe80::1']) assert.equal(isPublicSmtpIPv4(address), false, address);
  assert.equal(isPublicSmtpIPv4('8.8.8.8'), true);
  let lookups = 0;
  assert.equal(await resolveCustomSmtp('mail.example.com', async () => { lookups++; return [{ address: '8.8.8.8' }]; }), '8.8.8.8');
  assert.equal(lookups, 1);
  await assert.rejects(resolveCustomSmtp('mail.example.com', async () => [{ address: '8.8.8.8' }, { address: '127.0.0.1' }]), /EMAIL_UNSAFE_SMTP_ADDRESS/);
  await assert.rejects(resolveCustomSmtp('127.0.0.1', async () => { throw Error('must not resolve'); }), /EMAIL_UNSAFE_SMTP_HOST/);
});
test('Node Gmail transport uses TLS 465, sender identity and safe authentication errors', async () => {
  const oldKey = process.env.EMAIL_ENCRYPTION_KEY;
  process.env.EMAIL_ENCRYPTION_KEY = '34'.repeat(32);
  const original = nodemailer.createTransport;
  let options: any; let mode = 'ok'; let closed = 0;
  (nodemailer as any).createTransport = (input: unknown) => { options = input; return {
    async sendMail() { if (mode !== 'ok') throw Object.assign(new Error('secret-provider-response'), { code: 'EAUTH', responseCode: 535 }); return { messageId: 'mock', accepted: ['test@example.com'] }; },
    async verify() { return true; }, close() { closed++; },
  }; };
  try {
    const setting = { provider: 'GMAIL', fromName: 'Salon', fromEmail: 'salon@gmail.com', smtpUsername: 'salon@gmail.com', smtpHost: 'smtp.gmail.com', smtpPort: 465, smtpSecure: true, encryptedCredential: encryptEmailCredential('synthetic') } as BrandEmailSetting;
    const sent = await sendMerchantSmtp(setting, { to: 'test@example.com', subject: 'test' });
    assert.equal(sent.messageId, 'mock'); assert.equal(options.secure, true); assert.equal(options.port, 465); assert.equal(options.tls.rejectUnauthorized, true);
    mode = 'auth';
    await assert.rejects(sendMerchantSmtp(setting, { to: 'test@example.com', subject: 'test' }), error => { assert.equal((error as any).stage, 'AUTH'); assert.doesNotMatch((error as Error).message, /secret/); return true; });
    assert.equal(closed, 2);
  } finally { nodemailer.createTransport = original; if (oldKey === undefined) delete process.env.EMAIL_ENCRYPTION_KEY; else process.env.EMAIL_ENCRYPTION_KEY = oldKey; }
});
test('network, TLS and authentication failures are distinct and secret safe', () => {
  assert.equal(safeEmailError({ code: 'ESOCKET', command: 'CONN', message: 'secret' }).code, 'EMAIL_CONNECTION_FAILED');
  assert.equal(safeEmailError({ code: 'CERT_HAS_EXPIRED' }).stage, 'TLS');
  assert.equal(safeEmailError({ code: 'SMTP_535' }).statusCode, 422);
  assert.equal(safeEmailError({ stage: 'SEND', message: 'secret' }).deliveryUncertain, true);
  assert.equal(safeEmailError({ responseCode: 550, stage: 'SEND' }).code, 'EMAIL_PROVIDER_REJECTED');
  assert.equal(safeEmailError({ responseCode: 451, stage: 'SEND' }).code, 'EMAIL_PROVIDER_TEMPORARY_FAILURE');
  assert.equal(safeEmailError({ responseCode: 550, stage: 'SEND' }).deliveryUncertain, false);
});

test('all approved templates have escaped HTML, plain text, default language, money and Hong Kong calendar time', () => {
  for (const language of ['en','zh-CN','zh-HK']) for (const event of EMAIL_EVENTS) {
    const result = renderBusinessEmail(event, language, '<script>&Customer', [[0,'REF234'],[2,'<img src=x>'],[5,'CONFIRMED']]);
    assert.match(result.subject,/ABC Hair Salon/);
    assert.ok(result.text.includes('REF234'));
    assert.match(result.html,/&lt;script&gt;&amp;Customer/);
    assert.match(result.html,/&lt;img src=x&gt;/);
    assert.doesNotMatch(result.html,/<script>|<img src=x>/);
  }
  assert.match(renderBusinessEmail('BOOKING_CANCELLED','unsupported','Customer',[]).subject,/Booking cancelled/);
  assert.match(emailMoney('1234.56','HKD','en'),/1,234\.56/);
  assert.equal(emailAppointmentTime(new Date('2026-10-28T00:00:00Z'),'00:30','01:00'),'2026-10-28 00:30–01:00 (Asia/Hong_Kong)');
});


import { assessOutboxDelivery } from './brand-email-setting.outbox-validation.js';
import type { EmailOutbox, Prisma } from '../../../../generated/prisma/client.js';
import { enqueueBusinessEmail } from './brand-email-setting.outbox.js';
import { enqueueAppointmentEmail, enqueueGroupPurchaseEmail, enqueueRefundEmail } from './brand-email-setting.events.js';
import { processOneBusinessEmail, processBusinessEmailBatch, recoverStaleBusinessEmails } from './brand-email-setting.outbox-processor.js';
import { startEmailOutboxJob } from '../../jobs/email-outbox.job.js';

test('retired helpers and scheduler are inert with accidental true flag and cannot access storage', async () => {
 const prior=process.env.EMAIL_OUTBOX_ENABLED;process.env.EMAIL_OUTBOX_ENABLED='true';
 const db=new Proxy({}, {get(){throw Error('Retired email touched database');}}) as Prisma.TransactionClient;
 try {
  for(const eventType of EMAIL_EVENTS){
   assert.equal(await enqueueBusinessEmail({brandId:'brand',eventType,idempotencyKey:eventType,recipientEmail:'synthetic@example.com',subject:'Synthetic',html:'Synthetic'},db),null);
   assert.equal(await assessOutboxDelivery(db,{eventType} as EmailOutbox),'EMAIL_BUSINESS_EMAILS_RETIRED');
  }
  assert.equal(await enqueueAppointmentEmail(db,'id','RESERVE_NOW_RESERVED'),null);
  assert.equal(await enqueueGroupPurchaseEmail(db,'id'),null);assert.equal(await enqueueRefundEmail(db,'id'),null);
  assert.equal((await processOneBusinessEmail('id')).processed,false);assert.equal((await processBusinessEmailBatch()).enabled,false);assert.equal((await recoverStaleBusinessEmails()).recovered,0);
  assert.equal(startEmailOutboxJob(),undefined);
 } finally {if(prior===undefined)delete process.env.EMAIL_OUTBOX_ENABLED;else process.env.EMAIL_OUTBOX_ENABLED=prior;}
});

test('explicit submission uncertainty survives TLS/SSL and other error classification', () => {
 for(const code of ['ERR_SSL_PROTOCOL_ERROR','ERR_TLS_CERT_ALTNAME_INVALID','CERT_HAS_EXPIRED','ETIMEDOUT','ECONNRESET','ENOTFOUND','EAUTH']){
  const result=safeEmailError({code,stage:'SEND',deliveryUncertain:true});assert.equal(result.deliveryUncertain,true,code);
 }
 assert.equal(safeEmailError({stage:'TLS',deliveryUncertain:true}).deliveryUncertain,true);
 assert.equal(safeEmailError({code:'ERR_SSL_PROTOCOL_ERROR',stage:'CONNECT',deliveryUncertain:false}).deliveryUncertain,false);
 assert.equal(safeEmailError({responseCode:550,stage:'SEND',deliveryUncertain:false}).deliveryUncertain,false);
});
