import { Prisma } from "../../../../generated/prisma/client.js";
import { AppError } from "../../utils/app-error.js";
import { cents } from "../cancellation-refund/policy.calculation.js";
export async function walletPaymentFunding(
  tx: Prisma.TransactionClient,
  payment: {
    id: string;
    customerId: string;
    groupPurchaseId: string | null;
    appointmentId: string | null;
    amount: Prisma.Decimal;
    currency: string;
  },
) {
  if (!payment.groupPurchaseId && !payment.appointmentId)
    throw new AppError("WALLET_PAYMENT_REFERENCE_MISSING", 409);
  const wallet = await tx.wallet.findUnique({
    where: { customerId: payment.customerId },
  });
  if (!wallet || wallet.currency !== payment.currency)
    throw new AppError("WALLET_CURRENCY_MISMATCH", 409);
  const type = payment.groupPurchaseId
    ? "GROUP_PURCHASE_PAYMENT"
    : "APPOINTMENT_PAYMENT";
  let rows = await tx.walletTransaction.findMany({
    where: {
      walletId: wallet.id,
      type,
      amount: { lt: 0 },
      OR: [{ paymentId: payment.id }, { referenceId: payment.id }],
    },
  });
  if (!rows.length) {
    const resource = payment.groupPurchaseId
      ? { groupPurchaseId: payment.groupPurchaseId }
      : { appointmentId: payment.appointmentId };
    const payments = await tx.payment.findMany({
      where: {
        ...resource,
        provider: "WALLET",
        status: { in: ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"] },
      },
    });
    // Legacy business-reference rows are attributable only when there is one
    // original wallet payment. Never guess a split among historical payments.
    if (payments.length !== 1 || payments[0].id !== payment.id)
      throw new AppError("WALLET_LEDGER_MANUAL_RECONCILIATION_REQUIRED", 409);
    rows = await tx.walletTransaction.findMany({
      where: {
        walletId: wallet.id,
        type,
        referenceId: payment.groupPurchaseId ?? payment.appointmentId,
        paymentId: null,
        amount: { lt: 0 },
      },
    });
  }
  const sum = (balanceType: string) =>
    rows
      .filter((r) => r.balanceType === balanceType)
      .reduce((s, r) => s + cents(r.amount.negated()), 0);
  const paidCents = sum("PAID"),
    bonusCents = sum("BONUS");
  if (
    paidCents + bonusCents !== cents(payment.amount) ||
    rows.some(
      (r) =>
        !["PAID", "BONUS"].includes(r.balanceType) ||
        (r.paymentId !== null && r.paymentId !== payment.id),
    )
  )
    throw new AppError("WALLET_PAYMENT_LEDGER_MISMATCH", 409);
  return { wallet, paidCents, bonusCents };
}

export async function walletPaymentsFundingBatch(
  tx: Prisma.TransactionClient,
  payments: {
    id: string;
    customerId: string;
    groupPurchaseId: string | null;
    appointmentId: string | null;
    amount: Prisma.Decimal;
    currency: string;
  }[],
) {
  // =====================================================
  // 1. DEDUPLICATE PAYMENTS
  // =====================================================

  const uniquePayments = new Map<string, (typeof payments)[number]>();

  for (const payment of payments) {
    const existing = uniquePayments.get(payment.id);

    if (existing) {
      if (
        existing.customerId !== payment.customerId ||
        existing.groupPurchaseId !== payment.groupPurchaseId ||
        existing.appointmentId !== payment.appointmentId ||
        existing.currency !== payment.currency ||
        !existing.amount.equals(payment.amount)
      ) {
        throw new AppError("WALLET_PAYMENT_LEDGER_MISMATCH", 409);
      }
      continue;
    }

    uniquePayments.set(payment.id, payment);
  }

  const items = [...uniquePayments.values()];

  type Funding = Awaited<ReturnType<typeof walletPaymentFunding>>;
  const results = new Map<string, Funding>();

  if (!items.length) return results;

  // =====================================================
  // 2. VALIDATE REFERENCES
  // =====================================================

  for (const payment of items) {
    if (!payment.groupPurchaseId && !payment.appointmentId) {
      throw new AppError("WALLET_PAYMENT_REFERENCE_MISSING", 409);
    }
  }

  // =====================================================
  // 3. LOAD WALLETS IN ONE QUERY
  // =====================================================

  const wallets = await tx.wallet.findMany({
    where: {
      customerId: {
        in: [...new Set(items.map((p) => p.customerId))],
      },
    },
  });

  const walletByCustomer = new Map(
    wallets.map((wallet) => [wallet.customerId, wallet]),
  );

  for (const payment of items) {
    const wallet = walletByCustomer.get(payment.customerId);

    if (!wallet || wallet.currency !== payment.currency) {
      throw new AppError("WALLET_CURRENCY_MISMATCH", 409);
    }
  }

  // =====================================================
  // 4. LOAD DIRECT PAYMENT LEDGER ROWS
  // =====================================================

  const paymentIds = items.map((p) => p.id);
  const walletIds = wallets.map((w) => w.id);

  const directRows = await tx.walletTransaction.findMany({
    where: {
      walletId: { in: walletIds },
      type: {
        in: ["GROUP_PURCHASE_PAYMENT", "APPOINTMENT_PAYMENT"],
      },
      amount: { lt: 0 },
      OR: [
        { paymentId: { in: paymentIds } },
        { referenceId: { in: paymentIds } },
      ],
    },
  });

  const directByPayment = new Map<string, typeof directRows>();

  for (const payment of items) {
    const wallet = walletByCustomer.get(payment.customerId)!;
    const type = payment.groupPurchaseId
      ? "GROUP_PURCHASE_PAYMENT"
      : "APPOINTMENT_PAYMENT";

    directByPayment.set(
      payment.id,
      directRows.filter(
        (row) =>
          row.walletId === wallet.id &&
          row.type === type &&
          (row.paymentId === payment.id || row.referenceId === payment.id),
      ),
    );
  }

  // =====================================================
  // 5. IDENTIFY LEGACY PAYMENTS
  // =====================================================

  const legacyPayments = items.filter(
    (payment) => !(directByPayment.get(payment.id)?.length ?? 0),
  );

  if (legacyPayments.length) {
    // ===================================================
    // 6. VALIDATE LEGACY RESOURCE UNIQUENESS
    // ===================================================

    const groupIds = [
      ...new Set(
        legacyPayments
          .map((p) => p.groupPurchaseId)
          .filter((id): id is string => id !== null),
      ),
    ];

    const appointmentIds = [
      ...new Set(
        legacyPayments
          .filter((p) => !p.groupPurchaseId)
          .map((p) => p.appointmentId)
          .filter((id): id is string => id !== null),
      ),
    ];

    const resourceConditions: Prisma.PaymentWhereInput[] = [];

    if (groupIds.length) {
      resourceConditions.push({
        groupPurchaseId: { in: groupIds },
      });
    }

    if (appointmentIds.length) {
      resourceConditions.push({
        appointmentId: { in: appointmentIds },
      });
    }

    const resourcePayments = await tx.payment.findMany({
      where: {
        OR: resourceConditions,
        provider: "WALLET",
        status: {
          in: ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"],
        },
      },
      select: {
        id: true,
        groupPurchaseId: true,
        appointmentId: true,
      },
    });

    for (const payment of legacyPayments) {
      const matches = resourcePayments.filter((candidate) =>
        payment.groupPurchaseId
          ? candidate.groupPurchaseId === payment.groupPurchaseId
          : candidate.appointmentId === payment.appointmentId,
      );

      if (matches.length !== 1 || matches[0].id !== payment.id) {
        throw new AppError("WALLET_LEDGER_MANUAL_RECONCILIATION_REQUIRED", 409);
      }
    }
  }

  // =====================================================
  // 7. LOAD LEGACY LEDGER ROWS
  // =====================================================

  const legacyReferenceIds = [
    ...new Set(
      legacyPayments.map((p) => (p.groupPurchaseId ?? p.appointmentId)!),
    ),
  ];

  const legacyRows = legacyReferenceIds.length
    ? await tx.walletTransaction.findMany({
        where: {
          walletId: { in: walletIds },
          type: {
            in: ["GROUP_PURCHASE_PAYMENT", "APPOINTMENT_PAYMENT"],
          },
          referenceId: { in: legacyReferenceIds },
          paymentId: null,
          amount: { lt: 0 },
        },
      })
    : [];

  // =====================================================
  // 8. RECONCILE EACH PAYMENT
  // =====================================================

  for (const payment of items) {
    const wallet = walletByCustomer.get(payment.customerId)!;
    const type = payment.groupPurchaseId
      ? "GROUP_PURCHASE_PAYMENT"
      : "APPOINTMENT_PAYMENT";

    const direct = directByPayment.get(payment.id) ?? [];

    const rows = direct.length
      ? direct
      : legacyRows.filter(
          (row) =>
            row.walletId === wallet.id &&
            row.type === type &&
            row.referenceId ===
              (payment.groupPurchaseId ?? payment.appointmentId),
        );

    const sum = (balanceType: string) =>
      rows
        .filter((row) => row.balanceType === balanceType)
        .reduce((total, row) => total + cents(row.amount.negated()), 0);

    const paidCents = sum("PAID");
    const bonusCents = sum("BONUS");

    if (
      paidCents + bonusCents !== cents(payment.amount) ||
      rows.some(
        (row) =>
          !["PAID", "BONUS"].includes(row.balanceType) ||
          (row.paymentId !== null && row.paymentId !== payment.id),
      )
    ) {
      throw new AppError("WALLET_PAYMENT_LEDGER_MISMATCH", 409);
    }

    results.set(payment.id, {
      wallet,
      paidCents,
      bonusCents,
    });
  }

  return results;
}

export function walletRefundSplit(
  total: number,
  paid: number,
  before: number,
  amount: number,
) {
  if (
    ![total, paid, before, amount].every(Number.isSafeInteger) ||
    total <= 0 ||
    paid < 0 ||
    paid > total ||
    before < 0 ||
    amount <= 0 ||
    before + amount > total
  )
    throw new AppError("WALLET_REFUND_ALLOCATION_INVALID", 409);
  const cumulative = (value: number) =>
    Number(
      (BigInt(value) * BigInt(paid) * 2n + BigInt(total)) /
        (BigInt(total) * 2n),
    );
  const paidCents = cumulative(before + amount) - cumulative(before),
    bonusCents = amount - paidCents;
  if (
    paidCents < 0 ||
    bonusCents < 0 ||
    cumulative(before + amount) > paid ||
    before + amount - cumulative(before + amount) > total - paid
  )
    throw new AppError("WALLET_REFUND_ALLOCATION_INVALID", 409);
  return { paidCents, bonusCents };
}
