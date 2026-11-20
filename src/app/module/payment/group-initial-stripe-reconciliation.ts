import Stripe from "stripe";
import { Prisma } from "../../../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { stripe } from "../../lib/stripe.js";
import { AppError } from "../../utils/app-error.js";
import { stripeAmount } from "../../utils/transaction-currency.utils.js";

type Payment = Prisma.PaymentGetPayload<{}>;
type Purchase = Prisma.GroupPurchaseGetPayload<{}>;
const cancellable = new Set(["requires_payment_method", "requires_confirmation", "requires_action", "requires_capture"]);

function verify(payment: Payment, purchase: Purchase, intent: Stripe.PaymentIntent) {
  const expected = purchase.purchaseFlow === "DIRECT_BOOK" && purchase.bookingMethod === "DEPOSIT"
    ? purchase.depositAmount : purchase.amount;
  if (payment.provider !== "STRIPE" || payment.purpose !== "GROUP_PURCHASE" ||
      payment.groupPurchaseId !== purchase.id || payment.customerId !== purchase.customerId ||
      intent.id !== payment.providerPaymentId || intent.metadata?.paymentId !== payment.id ||
      intent.metadata?.groupPurchaseId !== purchase.id || intent.metadata?.customerId !== payment.customerId ||
      intent.metadata?.purpose !== "GROUP_PURCHASE" || intent.metadata?.paymentStage === "REMAINING" ||
      !expected || !expected.equals(payment.amount) || payment.currency !== purchase.currency ||
      intent.currency.toLowerCase() !== payment.currency.toLowerCase() ||
      intent.amount !== stripeAmount(payment.amount, payment.currency)) {
    throw new AppError("GROUP_PURCHASE_STRIPE_RECONCILIATION_IDENTITY_MISMATCH", 409);
  }
}

export async function markConfirmedGroupInitialCancellation(
  payment: Payment, purchase: Purchase, intent: Stripe.PaymentIntent,
  client?: Prisma.TransactionClient,
) {
  verify(payment, purchase, intent);
  if (intent.status !== "canceled" || intent.amount_received !== 0) {
    throw new AppError("GROUP_PURCHASE_STRIPE_CANCELLATION_UNCONFIRMED", 409);
  }
  const record = async (tx: Prisma.TransactionClient) => {
    const current = await tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
    verify(current, purchase, intent);
    if (current.paidAt || !["PENDING", "FAILED"].includes(current.status)) return { count: 0 };
    const id = `internal-group-initial-canceled-${payment.id}-${intent.id}`;
    if (await tx.stripeWebhookEvent.findUnique({ where: { id } })) return { count: 0 };
    const changed = await tx.payment.updateMany({
      where: {
        id: payment.id, provider: "STRIPE", providerPaymentId: intent.id,
        groupPurchaseId: purchase.id, customerId: purchase.customerId, purpose: "GROUP_PURCHASE",
        amount: payment.amount, currency: payment.currency, status: { in: ["PENDING", "FAILED"] }, paidAt: null,
      },
      data: { status: "FAILED", failedAt: current.failedAt ?? new Date() },
    });
    // A durable cancellation receipt avoids polling already-closed historical
    // attempts forever. This namespace cannot collide with Stripe's evt_ IDs.
    await tx.stripeWebhookEvent.upsert({ where: { id },
      create: { id, type: "internal.group_initial_intent.canceled" }, update: {} });
    return changed;
  };
  return client ? record(client) : prisma.$transaction(record,
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

async function reconcileCapture(intent: Stripe.PaymentIntent) {
  // A trusted provider retrieval reuses the same idempotent settlement/refund
  // path as webhooks. This internal receipt is never accepted from an HTTP body.
  const { paymentService } = await import("./payment.service.js");
  const event: Stripe.PaymentIntentSucceededEvent = {
    id: `internal-group-initial-reconcile-${intent.id}`, object: "event", api_version: null,
    created: Math.floor(Date.now() / 1000), livemode: Boolean(intent.livemode),
    pending_webhooks: 0, request: null, type: "payment_intent.succeeded", data: { object: intent },
  };
  await paymentService.handleGroupPurchaseStripeEvent(event, intent);
}

async function cancelVerified(payment: Payment, purchase: Purchase, intent: Stripe.PaymentIntent) {
  verify(payment, purchase, intent);
  if (intent.status !== "canceled") {
    if (!cancellable.has(intent.status)) return intent;
    try {
      intent = await stripe.paymentIntents.cancel(intent.id, { cancellation_reason: "abandoned" }, {
        idempotencyKey: `close-group-initial-${payment.id}`, maxNetworkRetries: 0, timeout: 15000,
      });
    } catch {
      // Cancellation may have succeeded or raced a capture. Never infer its
      // outcome from a timeout; a fresh retrieval decides the local transition.
      intent = await stripe.paymentIntents.retrieve(intent.id);
    }
    verify(payment, purchase, intent);
  }
  return intent;
}

/** All provider operations are outside database transactions. */
export async function prepareGroupInitialStripePayments(
  customerId: string, purchaseId: string, mode: "stripe" | "wallet",
): Promise<string[]> {
  const purchase = await prisma.groupPurchase.findUnique({ where: { id: purchaseId } });
  // Existing API validation retains its errors and ownership checks. Never
  // contact Stripe for a foreign, expired, settled or non-initial purchase.
  if (!purchase || purchase.customerId !== customerId || purchase.paymentStatus !== "PENDING" ||
      !purchase.reservationExpiresAt || purchase.reservationExpiresAt <= new Date() ||
      purchase.purchasedAt || purchase.settledPaymentId ||
      purchase.purchaseFlow === "DIRECT_BOOK" && purchase.bookingMethod === "RESERVE_NOW") return [];

  const payments = await prisma.payment.findMany({
    where: { groupPurchaseId: purchaseId, customerId, purpose: "GROUP_PURCHASE", provider: "STRIPE",
      status: { in: ["PENDING", "FAILED"] } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const closed: string[] = [];
  let keptPending = false;
  for (const payment of payments) {
    if (payment.paidAt) throw new AppError("GROUP_PURCHASE_CAPTURE_RECONCILIATION_REQUIRED", 409);
    if (!payment.providerPaymentId) {
      if (mode === "wallet" || payment.status === "FAILED" || keptPending)
        throw new AppError("STRIPE_PAYMENT_ALREADY_PENDING", 409);
      keptPending = true; // Creation retries use this payment's stable Stripe key.
      continue;
    }
    let intent: Stripe.PaymentIntent = await stripe.paymentIntents.retrieve(payment.providerPaymentId);
    verify(payment, purchase, intent);
    if (mode === "wallet" || payment.status === "FAILED" || keptPending || intent.status === "canceled") {
      intent = await cancelVerified(payment, purchase, intent);
    }
    if (intent.status === "canceled") {
      await markConfirmedGroupInitialCancellation(payment, purchase, intent);
      closed.push(payment.id);
    } else if (intent.status === "succeeded") {
      await reconcileCapture(intent);
      throw new AppError("GROUP_PURCHASE_PAYMENT_ALREADY_SUCCEEDED", 409);
    } else if (intent.status === "processing" || !cancellable.has(intent.status)) {
      throw new AppError("STRIPE_GROUP_PURCHASE_PAYMENT_PROCESSING", 409);
    } else if (mode === "wallet" || payment.status === "FAILED" || keptPending) {
      throw new AppError("GROUP_PURCHASE_STRIPE_CANCELLATION_UNCONFIRMED", 409);
    } else {
      keptPending = true;
    }
  }
  return closed;
}

/** Bounded recovery also covers inline expiry and pre-release historical rows. */
export async function reconcileExpiredGroupInitialStripePayments() {
  const keys = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT p.id FROM "Payment" p JOIN "GroupPurchase" g ON g.id = p."groupPurchaseId"
    WHERE CAST(p.purpose AS TEXT) = 'GROUP_PURCHASE' AND CAST(p.provider AS TEXT) = 'STRIPE'
      AND ((CAST(p.status AS TEXT) IN ('PENDING','FAILED') AND p."paidAt" IS NULL)
        OR CAST(p.status AS TEXT) = 'PAID')
      AND p."providerPaymentId" IS NOT NULL AND CAST(g."paymentStatus" AS TEXT) = 'FAILED'
      AND g."purchasedAt" IS NULL AND g."settledPaymentId" IS NULL
      AND NOT EXISTS (SELECT 1 FROM "StripeWebhookEvent" e
        WHERE e.id = 'internal-group-initial-canceled-' || p.id || '-' || p."providerPaymentId")
    ORDER BY p."updatedAt" ASC, p.id ASC LIMIT 100`);
  const payments = keys.length ? await prisma.payment.findMany({
    where: { id: { in: keys.map(key => key.id) } }, include: { groupPurchase: true },
  }) : [];
  let unresolved = 0;
  for (const payment of payments) {
    try {
      const purchase = payment.groupPurchase!;
      let intent: Stripe.PaymentIntent = await stripe.paymentIntents.retrieve(payment.providerPaymentId!);
      verify(payment, purchase, intent);
      if (payment.status === "PAID" && intent.status !== "succeeded") {
        throw new AppError("GROUP_PURCHASE_CAPTURE_RECONCILIATION_REQUIRED", 409);
      }
      if (intent.status === "succeeded") await reconcileCapture(intent);
      else {
        intent = await cancelVerified(payment, purchase, intent);
        if (intent.status === "succeeded") await reconcileCapture(intent);
        else if (intent.status === "canceled") await markConfirmedGroupInitialCancellation(payment, purchase, intent);
        else if (intent.status !== "canceled" && intent.status !== "processing") unresolved++;
      }
    } catch { unresolved++; }
  }
  if (unresolved) throw new AppError("GROUP_PURCHASE_PAYMENT_RECONCILIATION_REQUIRED", 503);
}
