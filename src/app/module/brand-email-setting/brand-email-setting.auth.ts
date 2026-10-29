import { randomUUID } from 'node:crypto';
import { prisma } from '../../lib/prisma.js';
import { resolveBusinessEmailDelivery } from './brand-email-setting.sender.js';
import { safeEmailError, EmailProviderError } from './brand-email-setting.errors.js';
import { transitionOutbox } from './brand-email-setting.outbox-history.js';

export async function sendMerchantSecurityEmail(payload: { brandId: string; userId: string; to: string; eventType: 'AUTH_PASSWORD_RESET_OTP' | 'AUTH_PASSWORD_RESET_SUCCESS'; subject: string; html: string }) {
  let delivery: Awaited<ReturnType<typeof resolveBusinessEmailDelivery>> | undefined;
  let configurationError: EmailProviderError | undefined;
  try { delivery = await resolveBusinessEmailDelivery(payload); }
  catch (error) { configurationError = safeEmailError(error); }
  const id = randomUUID();
  // History stores metadata only: never persist OTP HTML or reset credentials.
  await prisma.$transaction(async tx => {
    await tx.emailOutbox.create({ data: { id, brandId: payload.brandId, userId: payload.userId, eventType: payload.eventType,
      idempotencyKey: `${payload.brandId}:${payload.eventType}:${id}`, recipientEmail: payload.to, subject: payload.subject, html: '',
      status: configurationError ? 'SKIPPED' : 'SENDING', provider: delivery?.provider, attempts: delivery ? 1 : 0,
      attemptedAt: delivery ? new Date() : null, lockedUntil: delivery ? new Date(Date.now()+300000) : null, terminalAt: configurationError ? new Date() : null, skipReason: configurationError?.code,
      lastError: configurationError?.code, validationData: { generation: 'MERCHANT_AUTH_V1' } } });
    await tx.emailOutboxHistory.create({ data: { outboxId: id, sequence: 0, status: configurationError ? 'SKIPPED' : 'SENDING', attempt: delivery ? 1 : 0, code: configurationError?.code, provider: delivery?.provider } });
  });
  if (configurationError) throw configurationError;
  let accepted = false;
  try {
    const result = await delivery!.send();
    accepted = true;
    const saved = await prisma.$transaction(tx => transitionOutbox(tx, { id, status: 'SENDING' }, { status: 'SENT', lockedUntil:null, sentAt: new Date(), terminalAt: new Date(), providerMessageId: result.messageId ?? null }));
    if (!saved) throw new EmailProviderError('EMAIL_ACCEPTED_HISTORY_UNCERTAIN', 502, 'ACCEPTED', true);
    return result;
  } catch (error) {
    const safe = accepted ? new EmailProviderError('EMAIL_ACCEPTED_HISTORY_UNCERTAIN', 502, 'ACCEPTED', true) : safeEmailError(error);
    try { await prisma.$transaction(tx => transitionOutbox(tx, { id, status: 'SENDING' }, { status: safe.deliveryUncertain ? 'DELIVERY_UNCERTAIN' : 'FAILED', lockedUntil:null, terminalAt: new Date(), lastError: safe.code }, safe.code)); }
    catch { console.error('[Merchant Email]', { code: 'EMAIL_HISTORY_STORAGE_FAILED' }); }
    throw safe;
  }
}
