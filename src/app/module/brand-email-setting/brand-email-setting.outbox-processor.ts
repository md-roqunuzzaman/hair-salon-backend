import { randomUUID } from 'node:crypto';
import { prisma } from '../../lib/prisma.js';
import { resolveBusinessEmailDelivery } from './brand-email-setting.sender.js';
import { safeEmailError } from './brand-email-setting.errors.js';
import { assessOutboxDelivery, BUSINESS_EMAIL_GENERATION } from './brand-email-setting.outbox-validation.js';
import { transitionOutbox } from './brand-email-setting.outbox-history.js';
import { collectBusinessEmailEvents } from './brand-email-setting.events.js';
import { EMAIL_EVENTS } from './brand-email-setting.templates.js';
const LEASE_MS = 300000;
const enabled = () => process.env.EMAIL_OUTBOX_ENABLED === 'true';
const transition = (where: Parameters<typeof transitionOutbox>[1], data: Parameters<typeof transitionOutbox>[2], code: string | null = null) => prisma.$transaction(tx => transitionOutbox(tx, where, data, code));

export async function recoverStaleBusinessEmails() {
  if (!enabled()) return { recovered: 0, uncertain: 0 };
  let recovered = 0, uncertain = 0;
  const jobs = await prisma.emailOutbox.findMany({ where: { status: { in:['PROCESSING','SENDING'] }, lockedUntil:{lte:new Date()}, idempotencyKey:{startsWith:'merchant-v1:'} }, take:100 });
  for (const job of jobs) {
    const sending = job.status === 'SENDING';
    if (await transition({id:job.id,status:job.status,claimToken:job.claimToken,lockedUntil:{lte:new Date()}},
      {status:sending?'DELIVERY_UNCERTAIN':'PENDING',claimToken:null,lockedUntil:null,terminalAt:sending?new Date():null,nextAttemptAt:new Date(),lastError:sending?'EMAIL_ABANDONED_SEND_UNCERTAIN':'EMAIL_PRE_SEND_LEASE_EXPIRED'}, sending?'EMAIL_ABANDONED_SEND_UNCERTAIN':'EMAIL_PRE_SEND_LEASE_EXPIRED')) {
      if (sending) uncertain++; else recovered++;
    }
  }
  return { recovered, uncertain };
}
export async function processOneBusinessEmail(emailId: string) {
  if (!enabled()) return { processed:false,reason:'DISABLED' };
  const now = new Date();
  const email = await prisma.emailOutbox.findUnique({where:{id:emailId}});
  if (!email || email.status !== 'PENDING' || email.nextAttemptAt > now) return {processed:false,reason:'NOT_READY'};
  if ((email.validationData as any)?.generation !== BUSINESS_EMAIL_GENERATION || !EMAIL_EVENTS.includes(email.eventType as any)) return {processed:false,reason:'EMAIL_LEGACY_SNAPSHOT_UNVERIFIABLE'};
  if (email.attempts >= email.maxAttempts) {
    await transition({id:email.id,status:'PENDING',attempts:email.attempts},{status:'FAILED',terminalAt:now,lastError:'EMAIL_ATTEMPTS_EXHAUSTED'},'EMAIL_ATTEMPTS_EXHAUSTED');
    return {processed:false,status:'FAILED'};
  }
  const claimToken = randomUUID();
  if (!await transition({id:email.id,status:'PENDING',attempts:email.attempts,nextAttemptAt:{lte:now},OR:[{lockedUntil:null},{lockedUntil:{lte:now}}]},
    {status:'PROCESSING',claimToken,lockedUntil:new Date(now.getTime()+LEASE_MS),attempts:{increment:1}})) return {processed:false,reason:'ALREADY_CLAIMED'};
  let sending = false, accepted = false;
  const fence = () => ({id:email.id,status:sending?'SENDING':'PROCESSING',claimToken,lockedUntil:{gt:new Date()}});
  try {
    const reason = await assessOutboxDelivery(prisma,email);
    if (reason) {
      await transition(fence(),{status:'SKIPPED',skipReason:reason,terminalAt:new Date(),claimToken:null,lockedUntil:null},reason);
      return {processed:false,status:'SKIPPED',code:reason};
    }
    const delivery = await resolveBusinessEmailDelivery({brandId:email.brandId,to:email.recipientEmail,subject:email.subject,html:email.html,text:email.text??undefined,previousProvider:email.provider});
    if (!await transition(fence(),{status:'SENDING',provider:delivery.provider,attemptedAt:new Date()})) return {processed:false,reason:'LEASE_LOST'};
    sending = true;
    const result = await delivery.send(); accepted = true;
    const saved = await transition(fence(),{status:'SENT',sentAt:new Date(),terminalAt:new Date(),provider:result.provider,providerMessageId:result.messageId??null,claimToken:null,lockedUntil:null,lastError:null});
    if (!saved) throw new Error('Accepted delivery history could not be fenced');
    return {processed:true,status:'SENT'};
  } catch (error) {
    const safe = safeEmailError(error);
    const uncertain = accepted || (sending && safe.deliveryUncertain);
    const permanent = safe.stage === 'CONFIGURATION' || safe.stage === 'AUTH' || safe.statusCode === 422 || (safe.code !== 'EMAIL_PROVIDER_TEMPORARY_FAILURE' && safe.providerStatus !== undefined && safe.providerStatus >= 400 && safe.providerStatus < 500 && ![408,429].includes(safe.providerStatus));
    const attempts = email.attempts+1;
    const status = uncertain?'DELIVERY_UNCERTAIN':permanent||attempts>=email.maxAttempts?'FAILED':'PENDING';
    const code = accepted?'EMAIL_ACCEPTED_HISTORY_UNCERTAIN':safe.code;
    await transition(fence(),{status,claimToken:null,lockedUntil:null,lastError:code,terminalAt:status==='PENDING'?null:new Date(),nextAttemptAt:new Date(Date.now()+Math.min(2**attempts,60)*60000)},code);
    return {processed:false,status,code};
  }
}
export async function processBusinessEmailBatch(limit = 10) {
  // Discovery is independent of delivery activation; business transactions have
  // already committed. Never process pre-restoration/historical job keys.
  await collectBusinessEmailEvents();
  // Security sends are direct and never replayed. A crashed direct send is
  // quarantined even while business delivery is disabled.
  const security = await prisma.emailOutbox.findMany({ where:{status:'SENDING',lockedUntil:{lte:new Date()},eventType:{in:['AUTH_PASSWORD_RESET_OTP','AUTH_PASSWORD_RESET_SUCCESS','AUTH_EMAIL_VERIFICATION_OTP']}},take:100 });
  for (const job of security) if ((job.validationData as any)?.generation === 'MERCHANT_AUTH_V1') {
    await transition({id:job.id,status:'SENDING',lockedUntil:{lte:new Date()}},{status:'DELIVERY_UNCERTAIN',lockedUntil:null,terminalAt:new Date(),lastError:'EMAIL_ABANDONED_SEND_UNCERTAIN'},'EMAIL_ABANDONED_SEND_UNCERTAIN');
  }
  if (!enabled()) return {enabled:false,processed:0};
  await recoverStaleBusinessEmails();
  const jobs = await prisma.emailOutbox.findMany({where:{status:'PENDING',idempotencyKey:{startsWith:'merchant-v1:'},nextAttemptAt:{lte:new Date()}},orderBy:[{createdAt:'asc'},{id:'asc'}],take:Math.max(1,Math.min(10,Math.floor(limit)||1)),select:{id:true}});
  let processed = 0;
  for (const job of jobs) try { if ((await processOneBusinessEmail(job.id)).processed) processed++; }
  catch { console.error('[Email Outbox]',{code:'EMAIL_JOB_STORAGE_FAILED'}); }
  return {enabled:true,processed};
}
