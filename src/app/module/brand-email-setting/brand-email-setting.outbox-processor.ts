import { randomUUID } from 'node:crypto';
import { prisma } from '../../lib/prisma.js';
import { resolveBusinessEmailDelivery } from './brand-email-setting.sender.js';
import { safeEmailError } from './brand-email-setting.errors.js';
import { EMAIL_EVENTS } from './brand-email-setting.templates.js';

const LEASE_MS = 300_000;
const enabled = () => process.env.EMAIL_OUTBOX_ENABLED === 'true';

export const recoverStaleBusinessEmails = async () => {
  if (!enabled()) return { recovered: 0, uncertain: 0 };
  const now = new Date();
  const uncertain = await prisma.emailOutbox.updateMany({
    where: { status: 'SENDING', lockedUntil: { lte: now } },
    data: { status: 'DELIVERY_UNCERTAIN', claimToken: null, lockedUntil: null, lastError: 'EMAIL_ABANDONED_SEND_UNCERTAIN' },
  });
  const recovered = await prisma.emailOutbox.updateMany({
    where: { status: 'PROCESSING', lockedUntil: { lte: now } },
    data: { status: 'PENDING', claimToken: null, lockedUntil: null, nextAttemptAt: now, lastError: 'EMAIL_PRE_SEND_LEASE_EXPIRED' },
  });
  return { recovered: recovered.count, uncertain: uncertain.count };
};

export const processOneBusinessEmail = async (emailId: string) => {
  if (!enabled()) return { processed: false, reason: 'DISABLED' };
  const now = new Date();
  const email = await prisma.emailOutbox.findUnique({ where: { id: emailId } });
  if (!email || email.status !== 'PENDING' || email.nextAttemptAt > now) return { processed: false, reason: 'NOT_READY' };
  if (!(EMAIL_EVENTS as readonly string[]).includes(email.eventType)) {
    await prisma.emailOutbox.updateMany({ where: { id: emailId, status: 'PENDING' }, data: { status: 'FAILED', lastError: 'EMAIL_EVENT_NOT_APPROVED' } });
    return { processed: false, status: 'FAILED' };
  }
  if (email.attempts >= email.maxAttempts) {
    await prisma.emailOutbox.updateMany({ where: { id: emailId, status: 'PENDING', attempts: email.attempts }, data: { status: 'FAILED', lastError: 'EMAIL_ATTEMPTS_EXHAUSTED' } });
    return { processed: false, status: 'FAILED' };
  }
  const claimToken = randomUUID();
  const claim = await prisma.emailOutbox.updateMany({
    where: { id: emailId, status: 'PENDING', attempts: email.attempts, nextAttemptAt: { lte: now }, OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }] },
    data: { status: 'PROCESSING', claimToken, lockedUntil: new Date(now.getTime() + LEASE_MS), attempts: { increment: 1 } },
  });
  if (claim.count !== 1) return { processed: false, reason: 'ALREADY_CLAIMED' };
  let sending = false;
  try {
    const delivery = await resolveBusinessEmailDelivery({ brandId: email.brandId, to: email.recipientEmail, subject: email.subject, html: email.html, text: email.text ?? undefined, previousProvider: email.provider });
    const marked = await prisma.emailOutbox.updateMany({
      where: { id: emailId, status: 'PROCESSING', claimToken, lockedUntil: { gt: new Date() } },
      data: { status: 'SENDING', provider: delivery.provider, attemptedAt: new Date() },
    });
    if (marked.count !== 1) return { processed: false, reason: 'LEASE_LOST' };
    sending = true;
    const result = await delivery.send();
    const done = await prisma.emailOutbox.updateMany({
      where: { id: emailId, status: 'SENDING', claimToken, lockedUntil: { gt: new Date() } },
      data: { status: 'SENT', sentAt: new Date(), provider: result.provider, providerMessageId: result.messageId ?? null, claimToken: null, lockedUntil: null, lastError: null },
    });
    return { processed: done.count === 1, status: done.count === 1 ? 'SENT' : 'DELIVERY_UNCERTAIN' };
  } catch (error) {
    const safe = safeEmailError(error);
    const uncertain = sending && (safe.deliveryUncertain || safe.code === 'EMAIL_PROVIDER_FAILED');
    const permanent = !uncertain && (safe.stage === 'CONFIGURATION' ||
      (safe.statusCode >= 400 && safe.statusCode < 500 && safe.statusCode !== 429) ||
      (safe.code === 'EMAIL_PROVIDER_REQUEST_FAILED' && safe.providerStatus !== undefined && safe.providerStatus >= 400 && safe.providerStatus < 500 && ![408,429].includes(safe.providerStatus)));
    const attempts = email.attempts + 1;
    const status = uncertain ? 'DELIVERY_UNCERTAIN' : permanent || attempts >= email.maxAttempts ? 'FAILED' : 'PENDING';
    await prisma.emailOutbox.updateMany({
      where: { id: emailId, claimToken, status: sending ? 'SENDING' : 'PROCESSING', lockedUntil: { gt: new Date() } },
      data: { status, claimToken: null, lockedUntil: null, lastError: safe.code, nextAttemptAt: new Date(Date.now() + Math.min(2 ** attempts, 60) * 60_000) },
    });
    return { processed: false, status, code: safe.code };
  }
};

export const processBusinessEmailBatch = async (limit = 10) => {
  if (!enabled()) return { enabled: false, processed: 0 };
  await recoverStaleBusinessEmails();
  const jobs = await prisma.emailOutbox.findMany({ where: { status: 'PENDING', nextAttemptAt: { lte: new Date() } }, orderBy: { createdAt: 'asc' }, take: Math.max(1, Math.min(10, Math.floor(limit) || 1)), select: { id: true } });
  let processed = 0;
  for (const job of jobs) {
    try { if ((await processOneBusinessEmail(job.id)).processed) processed++; }
    catch { console.error('[Email Outbox]', { code: 'EMAIL_JOB_STORAGE_FAILED' }); }
  }
  return { enabled: true, processed };
};
