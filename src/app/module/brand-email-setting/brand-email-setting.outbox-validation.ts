import type { EmailOutbox, Prisma } from '../../../../generated/prisma/client.js';
export const BUSINESS_EMAIL_GENERATION = 'MERCHANT_V1';
export async function assessOutboxDelivery(db: Prisma.TransactionClient, job: EmailOutbox, now = new Date()) {
  const data = job.validationData as Record<string, any> | null;
  if (data?.generation === 'MERCHANT_AUTH_V1') return 'EMAIL_SECURITY_DIRECT_ONLY';
  if (!data || data.generation !== BUSINESS_EMAIL_GENERATION) return 'EMAIL_LEGACY_SNAPSHOT_UNVERIFIABLE';
  const brands = await db.brand.findMany({ select: { id: true }, take: 2 });
  if (brands.length !== 1 || brands[0]!.id !== job.brandId) return 'EMAIL_BRAND_CONTEXT_INVALID';
  if (data.kind === 'APPOINTMENT') {
    const a = await db.appointment.findUnique({ where: { id: data.id } });
    if (!a || a.customerId !== job.userId || a.id !== job.appointmentId) return 'EMAIL_RECORD_CONTEXT_INVALID';
    if (job.eventType === 'RESERVE_NOW_RESERVED' || job.eventType === 'BOOKING_RESCHEDULED') {
      const target = data.target;
      if (!target || !['RESERVED','CONFIRMED'].includes(a.appointmentStatus) || a.emailScheduleRevision !== target.revision || a.date.toISOString() !== target.date || a.startTime !== target.startTime || a.endTime !== target.endTime || a.staffId !== target.staffId) return 'EMAIL_BOOKING_OUTDATED';
      if (new Date(`${a.date.toISOString().slice(0,10)}T${a.startTime}:00+08:00`) <= now) return 'EMAIL_BOOKING_OUTDATED';
    }
    if (job.eventType === 'BOOKING_CANCELLED' && a.appointmentStatus !== 'CANCELLED') return 'EMAIL_RECORD_CONTEXT_INVALID';
  } else if (data.kind === 'REFUND') {
    const r = await db.refund.findUnique({ where: { id: data.id }, include: { payment: true } });
    if (!r || r.status !== 'SUCCEEDED' || r.payment.customerId !== job.userId) return 'EMAIL_RECORD_CONTEXT_INVALID';
  } else if (data.kind === 'GROUP') {
    const p = await db.groupPurchase.findUnique({ where: { id: data.id } });
    if (!p || p.customerId !== job.userId) return 'EMAIL_RECORD_CONTEXT_INVALID';
  } else return 'EMAIL_RECORD_CONTEXT_INVALID';
  // Historical financial receipts are not invalidated by later schedule changes.
  return null;
}
