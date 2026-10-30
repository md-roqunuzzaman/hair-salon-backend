import { z } from 'zod';
import { Prisma } from '../../../../generated/prisma/client.js';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../utils/app-error.js';
import { catchAsync } from '../../utils/catchAsync.js';
import { assessOutboxDelivery } from './brand-email-setting.outbox-validation.js';
import { transitionOutbox } from './brand-email-setting.outbox-history.js';
import { EMAIL_EVENTS } from './brand-email-setting.templates.js';
import type { EmailOutbox } from '../../../../generated/prisma/client.js';

const statuses = ['PENDING','PROCESSING','SENDING','SENT','FAILED','DELIVERY_UNCERTAIN','SKIPPED'] as const;
const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1), limit: z.coerce.number().int().min(1).max(100).default(100),
}).strict();
const querySchema = paginationSchema.extend({
  status: z.enum(statuses).optional(), eventType: z.enum([...EMAIL_EVENTS,'AUTH_PASSWORD_RESET_OTP','AUTH_PASSWORD_RESET_SUCCESS','AUTH_EMAIL_VERIFICATION_OTP']).optional(),
  provider: z.enum(['GMAIL','QQ','NETEASE_163','MICROSOFT_365','RESEND','CUSTOM_SMTP','PLATFORM_SMTP']).optional(),
  recipientEmail: z.email().max(320).transform(v => v.toLowerCase()).optional(),
  createdFrom: z.iso.datetime().optional(), createdTo: z.iso.datetime().optional(),
}).strict().refine(v => !v.createdFrom || !v.createdTo || v.createdFrom <= v.createdTo, 'Invalid date range');
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError('Invalid outbox request', 400);
  return result.data;
}
const safeCode = (code: string | null) => code && /^EMAIL_[A-Z_]{2,64}$/.test(code) ? code : code ? 'EMAIL_LEGACY_FAILURE' : null;
const mask = (email: string) => { const at = email.lastIndexOf('@'); return at > 0 ? `${email[0]}***@${email.slice(at+1)}` : '***'; };
function safeJob(job: EmailOutbox) {
  return { id: job.id, eventType: job.eventType, status: job.status, attempts: job.attempts, maxAttempts: job.maxAttempts,
    recipientMasked: mask(job.recipientEmail), appointmentId: job.appointmentId, nextAttemptAt: job.nextAttemptAt,
    attemptedAt: job.attemptedAt, sentAt: job.sentAt, terminalAt: job.terminalAt, provider: job.provider,
    providerMessageId: job.providerMessageId, lastError: safeCode(job.lastError), skipReason: safeCode(job.skipReason), createdAt: job.createdAt,
  };
}
function queryWhere(brandId: string, q: z.infer<typeof querySchema>): Prisma.EmailOutboxWhereInput {
  return { brandId, status: q.status, eventType: q.eventType, provider: q.provider, recipientEmail: q.recipientEmail,
    ...(q.createdFrom || q.createdTo ? { createdAt: { ...(q.createdFrom ? { gte: new Date(q.createdFrom) } : {}), ...(q.createdTo ? { lte: new Date(q.createdTo) } : {}) } } : {}) };
}
const getJob = async (brandId: string, jobId: unknown) => {
  const id = parse(z.uuid(), jobId);
  const job = await prisma.emailOutbox.findFirst({ where: { id, brandId } });
  if (!job) throw new AppError('Outbox job not found', 404);
  return job;
};
export const listOutbox = (audit = false) => catchAsync(async (req, res) => {
  const q = parse(querySchema, req.query);
  const where = queryWhere(String(req.params.brandId), q);
  const result = await prisma.$transaction(async tx => {
    const total = await tx.emailOutbox.count({ where });
    const jobs = await tx.emailOutbox.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (q.page-1)*q.limit, take: q.limit });
    const now = new Date();
    const data = [];
    for (const job of jobs) {
      const item: any = safeJob(job);
      if (audit) {
        const reason = await assessOutboxDelivery(tx, job, now);
        item.audit = { reason, disposition: job.status !== 'PENDING' ? 'NOT_PENDING' : !reason ? 'ELIGIBLE' : reason === 'EMAIL_BOOKING_OUTDATED' ? 'STALE' : 'BLOCKED', ageSeconds: Math.max(0, Math.floor((now.getTime()-job.createdAt.getTime())/1000)) };
      }
      data.push(item);
    }
    const statusCounts: Record<string, number> = {};
    if (audit) for (const status of statuses) statusCounts[status] = await tx.emailOutbox.count({ where: { ...where, status } });
    return { data, total, ...(audit ? { statusCounts } : {}) };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  res.json({ success: true, statusCode: 200, message: audit ? 'Read-only outbox eligibility audit' : 'Email outbox status retrieved', data: result.data,
    pagination: { page: q.page, limit: q.limit, total: result.total, totalPages: Math.ceil(result.total/q.limit) },
    ...(audit ? { summary: { statusCounts: result.statusCounts, eligibilityScope: 'CURRENT_PAGE', assessedAt: new Date().toISOString(), automaticDeliveryEnabled: process.env.EMAIL_OUTBOX_ENABLED === 'true', retirementReason: null } } : {}) });
});
export const getOutboxDetail = catchAsync(async (req, res) => {
  const job = await getJob(String(req.params.brandId), req.params.jobId);
  const reason = await assessOutboxDelivery(prisma, job);
  res.json({ success: true, statusCode: 200, data: { ...safeJob(job), validationReason: reason, historyNote: 'History covers recorded transitions only; legacy attempts are not reconstructed.' } });
});
export const getOutboxHistory = catchAsync(async (req, res) => {
  const q = parse(paginationSchema, req.query);
  const job = await getJob(String(req.params.brandId), req.params.jobId);
  const [rows, total] = await prisma.$transaction([
    prisma.emailOutboxHistory.findMany({ where: { outboxId: job.id }, orderBy: { sequence: 'desc' }, skip: (q.page-1)*q.limit, take: q.limit }),
    prisma.emailOutboxHistory.count({ where: { outboxId: job.id } }),
  ]);
  res.json({ success: true, statusCode: 200, data: rows.map(row => ({ id: row.id, sequence: row.sequence, status: row.status, attempt: row.attempt, provider: row.provider, code: safeCode(row.code), actorId: row.actorId, createdAt: row.createdAt })), pagination: { page: q.page, limit: q.limit, total, totalPages: Math.ceil(total/q.limit) } });
});
export const skipOutboxJob = catchAsync(async (req, res) => {
  parse(z.object({ reason: z.enum(['OWNER_REQUEST','OUTDATED','TEST_ONLY']) }).strict(), req.body);
  const job = await getJob(String(req.params.brandId), req.params.jobId);
  await prisma.$transaction(async tx => {
    if (!await transitionOutbox(tx, { id: job.id, brandId: job.brandId, status: 'PENDING', attempts: job.attempts, OR: [{ lockedUntil: null }, { lockedUntil: { lte: new Date() } }] }, { status: 'SKIPPED', skipReason: 'EMAIL_OWNER_SKIPPED', terminalAt: new Date(), lockedUntil: null, claimToken: null }, `EMAIL_OWNER_SKIP_${req.body.reason}`, req.user!.userId)) {
      throw new AppError('Job is no longer pending or has an active lease', 409);
    }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  res.json({ success: true, statusCode: 200, data: { id: job.id, status: 'SKIPPED' } });
});
