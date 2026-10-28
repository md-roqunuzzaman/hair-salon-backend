import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Prisma } from '../../../../generated/prisma/client.js';
import { getLocalizedContent } from '../../utils/localization.js';
import { DEFAULT_LANGUAGE, isLanguage } from '../../utils/language.js';
import { enqueueBusinessEmail } from './brand-email-setting.outbox.js';
import { emailAppointmentTime, emailMoney, renderBusinessEmail, type BusinessEmailEvent, type EmailDetail } from './brand-email-setting.templates.js';

// This repository is single-brand: never guess a brand if that invariant fails.
async function brandId(tx: Prisma.TransactionClient) {
  const brands = await tx.brand.findMany({ select: { id: true }, take: 2 });
  return brands.length === 1 ? brands[0]!.id : null;
}
type Recipient = { id: string; name: string; email: string; preferredLanguage: string };
async function enqueue(tx: Prisma.TransactionClient, customer: Recipient, event: BusinessEmailEvent, key: string, details: EmailDetail[], appointmentId?: string) {
  if (!z.email().safeParse(customer.email).success) return null;
  const brand = await brandId(tx);
  if (!brand) return null;
  return enqueueBusinessEmail({ brandId: brand, userId: customer.id, appointmentId, eventType: event, idempotencyKey: `${brand}:${event}:${key}`, recipientEmail: customer.email, ...renderBusinessEmail(event, customer.preferredLanguage, customer.name, details) }, tx);
}

export async function enqueueAppointmentEmail(tx: Prisma.TransactionClient, id: string, event: 'PAY_NOW_CONFIRMED'|'RESERVE_NOW_RESERVED'|'DEPOSIT_RECEIVED'|'BOOKING_CANCELLED'|'BOOKING_RESCHEDULED', previous?: { date: Date; startTime: string; endTime: string; staffId: string }) {
  const a = await tx.appointment.findUnique({ where: { id }, include: { customer: true, branch: true, staff: true, payments: { where: { status: 'PAID', purpose: 'APPOINTMENT_DEPOSIT' } } } });
  if (!a) return null;
  if (event === 'PAY_NOW_CONFIRMED' && (a.groupPurchaseId || a.bookingMethod !== 'PAY_NOW' || a.appointmentStatus !== 'CONFIRMED' || a.paymentStatus !== 'PAID')) return null;
  if (event === 'RESERVE_NOW_RESERVED' && (a.bookingMethod !== 'RESERVE_NOW' || a.appointmentStatus !== 'RESERVED')) return null;
  if (event === 'DEPOSIT_RECEIVED' && (a.groupPurchaseId || a.bookingMethod !== 'DEPOSIT' || a.appointmentStatus !== 'RESERVED' || a.paymentStatus !== 'PARTIALLY_PAID' || a.payments.length !== 1)) return null;
  if (event === 'BOOKING_CANCELLED' && a.appointmentStatus !== 'CANCELLED') return null;
  if (event === 'BOOKING_RESCHEDULED' && (!previous || !['RESERVED','CONFIRMED'].includes(a.appointmentStatus) || (a.date.getTime() === previous.date.getTime() && a.startTime === previous.startTime && a.endTime === previous.endTime && a.staffId === previous.staffId))) return null;
  const lang = isLanguage(a.customer.preferredLanguage) ? a.customer.preferredLanguage : DEFAULT_LANGUAGE;
  const name = getLocalizedContent(a.itemNameTranslations, lang, { name: a.itemName }).name;
  const branch = getLocalizedContent(a.branch.translations, lang, { name: a.branch.name }).name;
  const details: EmailDetail[] = [[0,a.orderNumber],[1,branch],[2,name],[3,a.staff.name],[4,emailAppointmentTime(a.date,a.startTime,a.endTime)],[5,a.appointmentStatus],[9,a.paymentStatus]];
  if (event === 'PAY_NOW_CONFIRMED' || event === 'DEPOSIT_RECEIVED') details.push([6,emailMoney(a.price,a.currency,lang)]);
  if (event === 'DEPOSIT_RECEIVED') details.push([7,emailMoney(a.payments[0]!.amount,a.currency,lang)],[8,emailMoney(a.remainingAmount ?? 0,a.currency,lang)]);
  if (previous) details.push([10,emailAppointmentTime(previous.date,previous.startTime,previous.endTime)]);
  return enqueue(tx,a.customer,event,event === 'BOOKING_RESCHEDULED' ? `${id}:${randomUUID()}` : id,details,id);
}

export async function enqueueGroupPurchaseEmail(tx: Prisma.TransactionClient, id: string) {
  const p = await tx.groupPurchase.findUnique({ where: { id }, include: { customer: true, package: true, settledPayment: true } });
  // Only the first committed purchase settlement owns this event; remaining
  // payments do not produce it again. A successful wallet payment is authoritative too.
  if (!p || !['PAID','PARTIALLY_PAID'].includes(p.paymentStatus)) return null;
  const paid = p.settledPayment ?? (p.bookingMethod === 'RESERVE_NOW' ? await tx.payment.findFirst({ where: { groupPurchaseId: p.id, status: 'PAID', purpose: 'GROUP_PURCHASE' }, orderBy: { paidAt: 'asc' } }) : null);
  if (!paid || paid.status !== 'PAID' || paid.customerId !== p.customerId || paid.groupPurchaseId !== p.id) return null;
  const lang = isLanguage(p.customer.preferredLanguage) ? p.customer.preferredLanguage : DEFAULT_LANGUAGE;
  const name = getLocalizedContent(p.package.translations,lang,{name:p.package.name}).name;
  const details: EmailDetail[] = [[0,p.id],[2,name],[11,String(p.quantity)],[6,emailMoney(p.amount,paid.currency,lang)],[12,emailMoney(paid.amount,paid.currency,lang)],[8,emailMoney(p.paymentStatus === 'PAID' ? 0 : p.remainingAmount ?? 0,paid.currency,lang)],[9,p.paymentStatus]];
  if (p.package.validDays !== null) details.push([13,String(p.package.validDays)]);
  return enqueue(tx,p.customer,'GROUP_PURCHASE_SUCCESSFUL',p.id,details);
}

export async function enqueueRefundEmail(tx: Prisma.TransactionClient, id: string) {
  const r = await tx.refund.findUnique({ where: { id }, include: { payment: { include: { customer: true, appointment: true, groupPurchase: true } } } });
  if (!r || r.status !== 'SUCCEEDED' || !r.refundedAt) return null;
  const p = r.payment;
  if (!p.appointment && !p.groupPurchase) return null; // No top-up refund email.
  if ((p.appointment && p.appointment.customerId !== p.customerId) || (p.groupPurchase && p.groupPurchase.customerId !== p.customerId)) return null;
  return enqueue(tx,p.customer,'REFUND_COMPLETED',r.id,[[0,p.appointment?.orderNumber ?? p.groupPurchaseId ?? p.id],[15,r.id],[14,emailMoney(r.amount,p.currency,p.customer.preferredLanguage)],[5,'SUCCEEDED']],p.appointmentId ?? undefined);
}
