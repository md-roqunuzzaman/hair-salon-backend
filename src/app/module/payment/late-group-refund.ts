import crypto from "node:crypto";
import Stripe from "stripe";
import { PaymentProvider, PaymentPurpose, Prisma, RefundStatus } from "../../../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { stripe } from "../../lib/stripe.js";
import { AppError } from "../../utils/app-error.js";

const reason = "LATE_GROUP_PURCHASE_PAYMENT";
function identity(payment: { purpose: string; id: string }) {
  return payment.purpose === PaymentPurpose.GROUP_PURCHASE
    ? { reason, key: `late-group-purchase-refund-${payment.id}` }
    : { reason: 'LATE_PAYMENT_AFTER_APPOINTMENT_EXPIRY', key: `late-payment-refund-${payment.id}` };
}
const uncertain = () => new AppError("Stripe refund outcome requires reconciliation; no new refund was issued", 503);
type RefundWithPayment = Prisma.RefundGetPayload<{ include: { payment: true } }>;

export async function getOrCreateLateGroupPurchaseRefund(paymentId: string, amount: Prisma.Decimal, client: Prisma.TransactionClient = prisma) {
  const payment = await client.payment.findUniqueOrThrow({where:{id:paymentId}});
  const {reason, key:idempotencyKey}=identity(payment);
  const existing = await client.refund.findMany({ where: { paymentId, reason }, take: 2, orderBy: { createdAt: "asc" } });
  if (existing.length > 1) throw new AppError("Multiple late refunds require manual reconciliation", 409);
  if (existing[0]) {
    const row = existing[0];
    if (!row.amount.equals(amount)) throw new AppError("Late refund amount mismatch", 409);
    if (row.idempotencyKey && row.idempotencyKey !== idempotencyKey) throw uncertain();
    if (row.idempotencyKey) return row;
    // Legacy rows might already have reached Stripe; never treat them as new.
    try {
      return await client.refund.update({ where: { id: row.id }, data: { idempotencyKey, refundAttemptedAt: row.refundAttemptedAt ?? row.createdAt } });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    }
  }
  try {
    return await client.refund.upsert({ where: { idempotencyKey }, create: { paymentId, amount, reason, idempotencyKey }, update: {} });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    return client.refund.findUniqueOrThrow({ where: { idempotencyKey } });
  }
}

function validateLocal(refund: RefundWithPayment) {
  const payment = refund.payment;
  const cents = refund.amount.mul(100).toNumber();
  if (payment.provider !== PaymentProvider.STRIPE ||
      ![PaymentPurpose.GROUP_PURCHASE, PaymentPurpose.APPOINTMENT, PaymentPurpose.APPOINTMENT_DEPOSIT, PaymentPurpose.APPOINTMENT_REMAINING].some(p=>p===payment.purpose) ||
      (payment.purpose===PaymentPurpose.GROUP_PURCHASE?!payment.groupPurchaseId:!payment.appointmentId) || !payment.providerPaymentId || payment.currency !== "HKD" ||
      refund.reason !== identity(payment).reason || !refund.amount.equals(payment.amount) || !Number.isSafeInteger(cents) || cents <= 0 ||
      refund.idempotencyKey !== identity(payment).key) {
    throw new AppError("Invalid late group purchase refund identity or amount", 409);
  }
  return cents;
}

export function verifyProviderRefund(refund: RefundWithPayment, provider: Stripe.Refund) {
  const cents = validateLocal(refund);
  const intentId = typeof provider.payment_intent === "string" ? provider.payment_intent : provider.payment_intent?.id;
  if (!provider.id || (refund.providerRefundId && provider.id !== refund.providerRefundId) ||
      intentId !== refund.payment.providerPaymentId || provider.amount !== cents ||
      provider.currency.toLowerCase() !== refund.payment.currency.toLowerCase() ||
      provider.metadata?.refundId !== refund.id || provider.metadata?.paymentId !== refund.paymentId ||
      provider.metadata?.reason !== identity(refund.payment).reason) {
    throw new AppError("Stripe refund identity, amount or currency mismatch", 409);
  }
}

export async function reconcileStripeRefund(refundId: string) {
  const refund = await prisma.refund.findUniqueOrThrow({ where: { id: refundId }, include: { payment: true } });
  validateLocal(refund);
  let provider: Stripe.Refund | undefined;
  if (refund.providerRefundId) {
    provider = await stripe.refunds.retrieve(refund.providerRefundId);
  } else {
    // Bound provider reads. No match is NOT proof that a timed-out create failed.
    const matches: Stripe.Refund[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 3; page++) {
      const list = await stripe.refunds.list({ payment_intent: refund.payment.providerPaymentId!, limit: 100, ...(cursor && { starting_after: cursor }) });
      for (const item of list.data) {
        if (item.metadata?.refundId === refund.id ||
            (item.metadata?.paymentId === refund.paymentId && item.metadata?.reason === identity(refund.payment).reason)) matches.push(item);
      }
      if (!list.has_more) break;
      if (page === 2 || !list.data.length) throw uncertain();
      cursor = list.data[list.data.length - 1].id;
    }
    if (matches.length > 1) throw new AppError("Multiple provider refunds require manual investigation", 409);
    provider = matches[0];
  }
  if (!provider) return { providerRefundId: null, status: RefundStatus.PENDING, requiresInvestigation: true };
  verifyProviderRefund(refund, provider);
  const failed = provider.status === "failed" || provider.status === "canceled";
  const status = provider.status === "succeeded" ? RefundStatus.SUCCEEDED : failed ? RefundStatus.FAILED : RefundStatus.PENDING;
  // Only the finalizer may mark SUCCEEDED together with payment + event + notification.
  await prisma.refund.updateMany({ where: { id: refund.id, status: { not: RefundStatus.SUCCEEDED }, OR: [{ providerRefundId: null }, { providerRefundId: provider.id }] }, data: { providerRefundId: provider.id, ...(failed && { status: RefundStatus.FAILED }) } });
  return { providerRefundId: provider.id, status, requiresInvestigation: failed || provider.status === "requires_action" || !provider.status };
}

export async function ensureLateGroupPurchaseRefund(refundId: string) {
  const refund = await prisma.refund.findUniqueOrThrow({ where: { id: refundId }, include: { payment: true } });
  const cents = validateLocal(refund);
  if (refund.providerRefundId || refund.refundAttemptedAt || refund.status !== RefundStatus.PENDING) return reconcileStripeRefund(refundId);
  const token = crypto.randomUUID();
  const claimed = await prisma.refund.updateMany({ where: { id: refundId, status: RefundStatus.PENDING, refundAttemptedAt: null, providerRefundId: null,
    OR: [{ refundClaimToken: null }, { refundClaimExpiresAt: { lte: new Date() } }] }, data: { refundClaimToken: token, refundClaimExpiresAt: new Date(Date.now() + 120_000) } });
  if (claimed.count !== 1) throw new AppError("Refund is already being processed", 503);
  try {
    const intent = await stripe.paymentIntents.retrieve(refund.payment.providerPaymentId!);
    if (intent.id !== refund.payment.providerPaymentId || intent.status !== "succeeded" || intent.amount !== cents || intent.amount_received !== cents ||
        intent.currency.toLowerCase() !== "hkd" || intent.metadata.paymentId !== refund.paymentId || intent.metadata.customerId !== refund.payment.customerId ||
        (refund.payment.groupPurchaseId ? intent.metadata.groupPurchaseId !== refund.payment.groupPurchaseId : intent.metadata.appointmentId !== refund.payment.appointmentId) || intent.metadata.purpose !== refund.payment.purpose) throw new AppError("Original Stripe payment verification failed", 409);
    const others = await prisma.refund.count({ where: { paymentId: refund.paymentId, id: { not: refundId }, status: { in: [RefundStatus.PENDING, RefundStatus.SUCCEEDED] } } });
    if (others) throw new AppError("Another refund already exists for this payment", 409);
    // Permanent attempt fence, BEFORE the external side effect. An expired lease never clears this.
    const marked = await prisma.refund.updateMany({ where: { id: refundId, refundClaimToken: token, refundClaimExpiresAt: { gt: new Date() }, refundAttemptedAt: null, providerRefundId: null }, data: { refundAttemptedAt: new Date() } });
    if (marked.count !== 1) throw uncertain();
    const provider = await stripe.refunds.create({ payment_intent: intent.id, amount: cents, metadata: { refundId, paymentId: refund.paymentId, ...(refund.payment.groupPurchaseId?{groupPurchaseId:refund.payment.groupPurchaseId}:{appointmentId:refund.payment.appointmentId!}), reason:identity(refund.payment).reason } }, { idempotencyKey: refund.idempotencyKey!, maxNetworkRetries: 0, timeout: 15000 });
    verifyProviderRefund(refund, provider);
    await prisma.refund.updateMany({ where: { id: refundId, refundClaimToken: token, status: RefundStatus.PENDING }, data: { providerRefundId: provider.id } });
    return reconcileStripeRefund(refundId);
  } finally {
    // Lease also expires if this cleanup cannot persist; attemptedAt still prevents resubmission.
    await prisma.refund.updateMany({ where: { id: refundId, refundClaimToken: token }, data: { refundClaimToken: null, refundClaimExpiresAt: null } });
  }
}
