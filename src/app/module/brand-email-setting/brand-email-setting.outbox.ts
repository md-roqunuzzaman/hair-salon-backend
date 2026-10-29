import { Prisma } from '../../../../generated/prisma/client.js';
import { prisma } from '../../lib/prisma.js';
import { EMAIL_EVENTS, type BusinessEmailEvent } from './brand-email-setting.templates.js';
import { assessOutboxDelivery } from './brand-email-setting.outbox-validation.js';
import { resolveBusinessEmailDelivery } from './brand-email-setting.sender.js';
import { EmailProviderError } from './brand-email-setting.errors.js';
import { z } from 'zod';
type Payload = { brandId: string; userId?: string; appointmentId?: string; eventType: BusinessEmailEvent; idempotencyKey: string; recipientEmail: string; subject: string; html: string; text?: string; validationData?: Prisma.InputJsonValue };
export async function enqueueBusinessEmail(payload: Payload, tx: Prisma.TransactionClient = prisma) {
  if (!z.email().safeParse(payload.recipientEmail).success || !EMAIL_EVENTS.includes(payload.eventType)) return null;
  const existing = await tx.emailOutbox.findUnique({ where: { idempotencyKey: payload.idempotencyKey } });
  if (existing) return existing; // Never revive historical skipped/failed/uncertain jobs.
  let reason: string | null = null;
  try { await resolveBusinessEmailDelivery({ brandId: payload.brandId, to: payload.recipientEmail, subject: payload.subject, html: payload.html }); }
  catch (error) {
    // Provider readiness is a terminal non-send reason. A database outage is
    // not: roll back discovery so the durable business source is scanned again.
    if (!(error instanceof EmailProviderError)) throw error;
    reason = error.code;
  }
  const candidate = { ...payload, recipientEmail: payload.recipientEmail.toLowerCase(), status: 'PENDING' };
  reason ??= await assessOutboxDelivery(tx, candidate as any);
  const job = await tx.emailOutbox.upsert({ where: { idempotencyKey: payload.idempotencyKey }, update: {}, create: {
    ...candidate, status: reason ? 'SKIPPED' : 'PENDING', skipReason: reason, lastError: reason, terminalAt: reason ? new Date() : null,
  } });
  await tx.emailOutboxHistory.upsert({ where: { id: `${job.id}:created` }, update: {}, create: { id: `${job.id}:created`, outboxId: job.id, sequence: 0, status: job.status, attempt: 0, code: reason } });
  return job;
}
