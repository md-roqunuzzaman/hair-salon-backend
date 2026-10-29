import { prisma } from '../../lib/prisma.js';
import type { Prisma } from '../../../../generated/prisma/client.js';
import { getLocalizedContent } from '../../utils/localization.js';
import { DEFAULT_LANGUAGE, isLanguage } from '../../utils/language.js';
import { enqueueBusinessEmail } from './brand-email-setting.outbox.js';
import { BUSINESS_EMAIL_GENERATION } from './brand-email-setting.outbox-validation.js';
import { emailAppointmentTime, emailMoney, renderBusinessEmail, type BusinessEmailEvent, type EmailDetail } from './brand-email-setting.templates.js';

const successful = ['PAID','PARTIALLY_REFUNDED','REFUNDED'] as const;
async function enqueue(tx: Prisma.TransactionClient, customer: { id: string; email: string; name: string; preferredLanguage: string }, event: BusinessEmailEvent, key: string, details: EmailDetail[], validation: Prisma.InputJsonObject, appointmentId?: string) {
  const brands = await tx.brand.findMany({ select: { id: true }, take: 2 });
  if (brands.length !== 1) throw new Error('EMAIL_BRAND_CONTEXT_INVALID');
  const brandId = brands[0]!.id;
  return enqueueBusinessEmail({ brandId, userId: customer.id, appointmentId, eventType: event,
    idempotencyKey: `merchant-v1:${brandId}:${event}:${key}`, recipientEmail: customer.email,
    ...renderBusinessEmail(event, customer.preferredLanguage, customer.name, details), validationData: { generation: BUSINESS_EMAIL_GENERATION, ...validation } }, tx);
}
export async function enqueueAppointmentEmail(tx: Prisma.TransactionClient, id: string, event: 'PAY_NOW_CONFIRMED'|'RESERVE_NOW_RESERVED'|'DEPOSIT_RECEIVED'|'BOOKING_CANCELLED'|'BOOKING_RESCHEDULED', previous?: { date: Date; startTime: string; endTime: string; staffId: string }, key = id, target?: { date: string; startTime: string; endTime: string; staffId: string; revision?: number }) {
  const a = await tx.appointment.findUnique({ where: { id }, include: { customer: true, branch: true, staff: true, payments: { where: { status: { in: [...successful] } } } } });
  if (!a) return null;
  if (event === 'PAY_NOW_CONFIRMED' && (a.groupPurchaseId || a.bookingMethod !== 'PAY_NOW' || !a.payments.some(p => p.purpose === 'APPOINTMENT'))) return null;
  if (event === 'RESERVE_NOW_RESERVED' && a.bookingMethod !== 'RESERVE_NOW') return null;
  const deposit = a.payments.find(p => p.purpose === 'APPOINTMENT_DEPOSIT');
  if (event === 'DEPOSIT_RECEIVED' && (a.groupPurchaseId || a.bookingMethod !== 'DEPOSIT' || !deposit)) return null;
  if (event === 'BOOKING_CANCELLED' && a.appointmentStatus !== 'CANCELLED') return null;
  if (event === 'BOOKING_RESCHEDULED' && (!previous || !target || (previous.date.toISOString() === target.date && previous.startTime === target.startTime && previous.endTime === target.endTime && previous.staffId === target.staffId))) return null;
  const lang = isLanguage(a.customer.preferredLanguage) ? a.customer.preferredLanguage : DEFAULT_LANGUAGE;
  const name = getLocalizedContent(a.itemNameTranslations, lang, { name: a.itemName }).name;
  const branch = getLocalizedContent(a.branch.translations, lang, { name: a.branch.name }).name;
  const schedule = target ?? { date: a.date.toISOString(), startTime: a.startTime, endTime: a.endTime, staffId: a.staffId, revision: event === 'RESERVE_NOW_RESERVED' ? 0 : a.emailScheduleRevision };
  const details: EmailDetail[] = [[0,a.orderNumber],[1,branch],[2,name],[3,a.staff.name],[4,emailAppointmentTime(new Date(schedule.date),schedule.startTime,schedule.endTime)],[5,a.appointmentStatus],[9,a.paymentStatus]];
  if (event === 'PAY_NOW_CONFIRMED' || event === 'DEPOSIT_RECEIVED') details.push([6,emailMoney(a.price,a.currency,lang)]);
  if (event === 'DEPOSIT_RECEIVED') details.push([7,emailMoney(deposit!.amount,a.currency,lang)],[8,emailMoney(Math.max(0,Number(a.price)-Number(deposit!.amount)),a.currency,lang)]);
  if (previous) details.push([10,emailAppointmentTime(previous.date,previous.startTime,previous.endTime)]);
  return enqueue(tx,a.customer,event,key,details,{ kind: 'APPOINTMENT', id, target: schedule },id);
}
export async function enqueueGroupPurchaseEmail(tx: Prisma.TransactionClient, id: string, sourcePaymentId?: string) {
  const p = await tx.groupPurchase.findUnique({ where: { id }, include: { customer: true, package: true, settledPayment: true } });
  if (!p) return null;
  const paid = p.settledPayment ?? await tx.payment.findFirst({ where: { groupPurchaseId: id, status: { in: [...successful] }, purpose: 'GROUP_PURCHASE', paidAt: { not: null } }, orderBy: [{ paidAt: 'asc' }, { id: 'asc' }] });
  if (!paid || !successful.includes(paid.status as any) || paid.customerId !== p.customerId || paid.groupPurchaseId !== id || (sourcePaymentId && sourcePaymentId !== paid.id)) return null;
  const lang = isLanguage(p.customer.preferredLanguage) ? p.customer.preferredLanguage : DEFAULT_LANGUAGE;
  const details: EmailDetail[] = [[0,p.id],[2,getLocalizedContent(p.package.translations,lang,{name:p.package.name}).name],[11,String(p.quantity)],[6,emailMoney(p.amount,paid.currency,lang)],[12,emailMoney(paid.amount,paid.currency,lang)],[8,emailMoney(Math.max(0,Number(p.amount)-Number(paid.amount)),paid.currency,lang)],[9,Number(paid.amount)<Number(p.amount)?'PARTIALLY_PAID':'PAID']];
  if (p.package.validDays !== null) details.push([13,String(p.package.validDays)]);
  return enqueue(tx,p.customer,'GROUP_PURCHASE_SUCCESSFUL',id,details,{ kind:'GROUP',id });
}
export async function enqueueRefundEmail(tx: Prisma.TransactionClient, id: string) {
  const r = await tx.refund.findUnique({ where: { id }, include: { payment: { include: { customer: true, appointment: true, groupPurchase: true } } } });
  if (!r || r.status !== 'SUCCEEDED' || !r.refundedAt) return null;
  const p = r.payment;
  if ((!p.appointment && !p.groupPurchase) || (p.appointment && p.appointment.customerId !== p.customerId) || (p.groupPurchase && p.groupPurchase.customerId !== p.customerId)) return null;
  return enqueue(tx,p.customer,'REFUND_COMPLETED',id,[[0,p.appointment?.orderNumber ?? p.groupPurchaseId ?? p.id],[15,id],[14,emailMoney(r.amount,p.currency,p.customer.preferredLanguage)],[5,'SUCCEEDED']],{ kind:'REFUND',id },p.appointmentId ?? undefined);
}

// Email storage failures roll back only this independent reconciliation transaction.
// Repeated bounded cycles catch transactions committed after an earlier scan passed
// their timestamp; stable keys suppress duplicates without a clock-skew assumption.
export async function collectBusinessEmailEvents(limit = 10) {
  let collected = 0;
  const definitions = [
    ['RESERVATIONS','appointment','createdAt',{ bookingMethod:'RESERVE_NOW' }],
    ['APPOINTMENT_PAYMENTS','appointment','emailPaymentConfirmedAt',{}],
    ['GROUP_PAYMENTS','groupPurchase','emailPurchaseConfirmedAt',{}],
    ['CANCELLATIONS','appointment','cancelledAt',{ appointmentStatus:'CANCELLED' }],
    ['RESCHEDULES','notification','createdAt',{ type:'BOOKING_RESCHEDULED' }],
    ['REFUNDS','refund','refundedAt',{ status:'SUCCEEDED' }],
  ] as const;
  for (const [stream,model,time,filter] of definitions) {
    try {
      await prisma.$transaction(async tx => {
        const cursor = await tx.emailEventCursor.findUnique({ where: { id: stream } });
        if (!cursor) throw new Error('EMAIL_COLLECTION_MIGRATION_REQUIRED');
        const rows: any[] = await (tx[model] as any).findMany({ where: { ...filter, [time]: { gte: cursor.startedAt },
          ...(cursor.afterAt ? { OR:[{[time]:{gt:cursor.afterAt}},{[time]:cursor.afterAt,id:{gt:cursor.afterId!}}] } : {}) }, orderBy:[{[time]:'asc'},{id:'asc'}],take:Math.max(1,Math.min(limit,25)) });
        for (const row of rows) {
          if (stream === 'RESERVATIONS') await enqueueAppointmentEmail(tx,row.id,'RESERVE_NOW_RESERVED');
          if (stream === 'APPOINTMENT_PAYMENTS') await enqueueAppointmentEmail(tx,row.id,row.bookingMethod === 'DEPOSIT' ? 'DEPOSIT_RECEIVED' : 'PAY_NOW_CONFIRMED');
          if (stream === 'GROUP_PAYMENTS') await enqueueGroupPurchaseEmail(tx,row.id);
          if (stream === 'CANCELLATIONS') await enqueueAppointmentEmail(tx,row.id,'BOOKING_CANCELLED');
          if (stream === 'REFUNDS') await enqueueRefundEmail(tx,row.id);
          if (stream === 'RESCHEDULES') {
            const intent = row.emailIntent as any;
            // Only new explicit snapshots are eligible; never infer old reschedules.
            if (intent?.appointmentId && intent?.previous?.date && intent?.target?.date) {
              const a = await tx.appointment.findUnique({ where: { id:intent.appointmentId } });
              if (a && a.customerId === row.userId) await enqueueAppointmentEmail(tx,a.id,'BOOKING_RESCHEDULED',{...intent.previous,date:new Date(intent.previous.date)},row.id,intent.target);
            }
          }
          collected++;
        }
        const last = rows.at(-1);
        await tx.emailEventCursor.update({ where:{id:stream},data:last?{afterAt:last[time],afterId:last.id}:{afterAt:null,afterId:null} });
      });
    } catch { console.error('[Email Collection]', { code:'EMAIL_COLLECTION_STORAGE_FAILED', stream }); }
  }
  return { collected };
}
