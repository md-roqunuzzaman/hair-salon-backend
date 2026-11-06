import { appointmentTimezone } from "../../utils/appointment-timezone.utils.js";
import {
  assertCurrencyAmount,
  currencyDigits,
  historicalPurchaseCurrency,
  getPurchaseCurrency,
} from "../../utils/transaction-currency.utils.js";
import { notificationTemplates } from "../notification/notification.templates.js";
import { createHmac } from "node:crypto";
import { Prisma, Role } from "../../../../generated/prisma/client.js";
import config from "../../config/index.js";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../utils/app-error.js";
import { auditLogService } from "../auditLog/auditLog.service.js";
import { notificationService } from "../notification/notification.service.js";
import { confirmationBody } from "./cancellation-refund.validation.js";
import {
  appointmentTime,
  cents,
  evaluatePolicy,
  isSnapshot,
  money,
  PolicySnapshot,
} from "./policy.calculation.js";
import {
  Confirmation,
  ExecutionSnapshot,
  executionSnapshot,
} from "./cancellation-refund.interface.js";
import { policyTimeMinutes } from "./policy-time.js";
import { purchaseExpired } from "./policy.snapshot.js";
import {
  groupRefundFunding,
  allocateRefund,
} from "../refund-request/refund-allocation.plan.js";
import { randomUUID } from "node:crypto";
import { PaymentProvider } from "../../../../generated/prisma/enums.js";
import { walletPaymentsFundingBatch } from "../wallet/wallet-payment-ledger.js";
import {
  createPolicyPreviewToken,
  verifyPolicyPreviewToken,
} from "../../utils/policy-preview-token.utils.js";
const active = ["PENDING", "APPROVED", "PROCESSING"] as const;
const signature = (value: unknown) =>
  createHmac("sha256", config.jwt_access_secret)
    .update(JSON.stringify(value))
    .digest("hex");
const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;
async function access(
  tx: Prisma.TransactionClient,
  record: {
    customerId: string;
    branchId: string;
  },
  userId: string,
  role: string,
) {
  if (role === Role.BRAND_OWNER) return;
  if (role === Role.CUSTOMER && record.customerId === userId) return;
  if (
    role === Role.BRANCH_MANAGER &&
    (await tx.branchManagerBranch.findUnique({
      where: { userId_branchId: { userId, branchId: record.branchId } },
    }))
  )
    return;
  throw new AppError("CANCELLATION_ACCESS_DENIED", 403);
}
function remaining(payment: {
  amount: Prisma.Decimal;
  refunds: {
    amount: Prisma.Decimal;
    status: string;
  }[];
}) {
  return (
    cents(payment.amount) -
    payment.refunds
      .filter((r) => r.status === "SUCCEEDED")
      .reduce((sum, r) => sum + cents(r.amount), 0)
  );
}
async function funding(tx: Prisma.TransactionClient, payments: any[]) {
  const eligible = payments.filter(
    (p) =>
      ["STRIPE", "WALLET"].includes(p.provider) &&
      ["PAID", "PARTIALLY_REFUNDED"].includes(p.status),
  );
  if (
    eligible.some(
      (p) =>
        !Number.isInteger(currencyDigits(p.currency)) ||
        p.refunds.some((r: any) => r.status === "PENDING"),
    )
  )
    throw new AppError("REFUND_RECONCILIATION_REQUIRED", 409);
  if (eligible.length > 1)
    throw new AppError("MULTIPLE_PAYMENTS_REQUIRE_MANUAL_REVIEW", 409);
  const payment = eligible[0] ?? null;
  const pending = payment
    ? await tx.refundRequest.findFirst({
        where: { paymentId: payment.id, status: { in: [...active] } },
      })
    : null;
  return { payment, pending };
}

async function loadAppointmentRefundBatch(
  tx: Prisma.TransactionClient,
  appointmentIds: string[],
) {
  const ids = [...new Set(appointmentIds)];

  const appointments = await tx.appointment.findMany({
    where: {
      id: {
        in: ids,
      },
    },
    include: {
      payments: {
        include: {
          refunds: true,
        },
      },
      groupPurchase: true,
    },
  });

  type AppointmentWithRefundData = (typeof appointments)[number];

  const appointmentMap = new Map<string, AppointmentWithRefundData>(
    appointments.map((appointment) => [appointment.id, appointment]),
  );

  const eligiblePaymentIds = appointments.flatMap((appointment) => {
    if (appointment.groupPurchaseId !== null) {
      return [];
    }

    return appointment.payments
      .filter(
        (payment) =>
          ["APPOINTMENT", "APPOINTMENT_DEPOSIT"].includes(payment.purpose) &&
          ["STRIPE", "WALLET"].includes(payment.provider) &&
          ["PAID", "PARTIALLY_REFUNDED"].includes(payment.status),
      )
      .map((payment) => payment.id);
  });

  const pendingRequests =
    eligiblePaymentIds.length > 0
      ? await tx.refundRequest.findMany({
          where: {
            paymentId: {
              in: eligiblePaymentIds,
            },
            status: {
              in: ["PENDING", "APPROVED", "PROCESSING"],
            },
          },
          select: {
            paymentId: true,
          },
        })
      : [];

  const pendingPaymentIds = new Set<string>(
    pendingRequests.map((request) => request.paymentId),
  );

  return {
    appointments: appointmentMap,
    pendingPaymentIds,
  };
}

async function loadGroupRefundBatch(
  tx: Prisma.TransactionClient,
  purchaseIds: string[],
) {
  // =====================================================
  // 1. UNIQUE PURCHASE IDS
  // =====================================================

  const ids = [...new Set(purchaseIds)];

  // =====================================================
  // 2. BATCH LOAD PURCHASES
  // =====================================================

  const purchases = ids.length
    ? await tx.groupPurchase.findMany({
        where: {
          id: { in: ids },
        },
        include: {
          appointments: true,
          payments: {
            include: {
              refunds: true,
            },
            orderBy: [{ paidAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
          },
        },
      })
    : [];

  type Purchase = (typeof purchases)[number];
  type Payment = Purchase["payments"][number];

  const purchaseMap = new Map<string, Purchase>(
    purchases.map((purchase) => [purchase.id, purchase]),
  );

  // =====================================================
  // 3. FILTER ELIGIBLE PAYMENTS
  // =====================================================

  const eligibleByPurchase = new Map<string, Payment[]>();

  const allPayments: Payment[] = [];

  for (const purchase of purchases) {
    const eligible = purchase.payments.filter(
      (payment) =>
        payment.purpose === "GROUP_PURCHASE" &&
        ["STRIPE", "WALLET"].includes(payment.provider) &&
        ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"].includes(payment.status) &&
        !payment.refunds.some(
          (refund) =>
            refund.idempotencyKey ===
            `late-group-purchase-refund-${payment.id}`,
        ),
    );

    eligibleByPurchase.set(purchase.id, eligible);

    allPayments.push(...eligible);
  }

  // =====================================================
  // 4. BATCH LOAD ALLOCATIONS
  // =====================================================

  const paymentIds = allPayments.map((payment) => payment.id);

  const allocations = paymentIds.length
    ? await tx.refundAllocation.findMany({
        where: {
          paymentId: { in: paymentIds },
          status: {
            in: ["RESERVED", "PROCESSING"],
          },
        },
        select: {
          paymentId: true,
          amount: true,
        },
      })
    : [];

  const reservedCentsByPayment = new Map<string, number>();

  for (const allocation of allocations) {
    reservedCentsByPayment.set(
      allocation.paymentId,
      (reservedCentsByPayment.get(allocation.paymentId) ?? 0) +
        cents(allocation.amount),
    );
  }

  // =====================================================
  // 5. BATCH LOAD PENDING REFUND REQUESTS
  // =====================================================

  const pendingRequests = paymentIds.length
    ? await tx.refundRequest.findMany({
        where: {
          paymentId: { in: paymentIds },
          status: {
            in: ["PENDING", "APPROVED", "PROCESSING"],
          },
        },
        select: {
          paymentId: true,
        },
      })
    : [];

  const pendingPaymentIds = new Set<string>(
    pendingRequests.map((request) => request.paymentId),
  );

  // =====================================================
  // 6. VALIDATE PAYMENTS PER PURCHASE
  // =====================================================

  const errorsByPurchase = new Map<string, AppError>();

  for (const purchase of purchases) {
    const payments = eligibleByPurchase.get(purchase.id) ?? [];

    try {
      for (const payment of payments) {
        if (
          payment.customerId !== purchase.customerId ||
          payment.currency !==
            historicalPurchaseCurrency(
              purchase.currency,
              payments.map((row) => row.currency),
            ) ||
          (payment.provider === "STRIPE" && !payment.providerPaymentId) ||
          payment.refunds.some((refund) => refund.status === "PENDING")
        ) {
          throw new AppError("REFUND_RECONCILIATION_REQUIRED", 409);
        }
      }
    } catch (error) {
      if (error instanceof AppError) {
        errorsByPurchase.set(purchase.id, error);
      } else {
        throw error;
      }
    }
  }

  // =====================================================
  // 7. BATCH VALIDATE WALLET FUNDING
  // =====================================================

  const validPurchases = purchases.filter(
    (purchase) => !errorsByPurchase.has(purchase.id),
  );

  const walletPayments = validPurchases.flatMap((purchase) =>
    (eligibleByPurchase.get(purchase.id) ?? []).filter(
      (payment) => payment.provider === "WALLET",
    ),
  );

  if (walletPayments.length) {
    try {
      await walletPaymentsFundingBatch(tx, walletPayments);
    } catch (error) {
      if (!(error instanceof AppError)) {
        throw error;
      }

      // Fallback: isolate the failed purchase.
      for (const purchase of validPurchases) {
        const payments = (eligibleByPurchase.get(purchase.id) ?? []).filter(
          (payment) => payment.provider === "WALLET",
        );

        if (!payments.length) {
          continue;
        }

        try {
          await walletPaymentsFundingBatch(tx, payments);
        } catch (purchaseError) {
          if (purchaseError instanceof AppError) {
            errorsByPurchase.set(purchase.id, purchaseError);
          } else {
            throw purchaseError;
          }
        }
      }
    }
  }

  // =====================================================
  // 8. BUILD PURCHASE-WISE FUNDING
  // =====================================================

  const fundingByPurchase = new Map<
    string,
    {
      payments: Payment[];
      funds: {
        paymentId: string;
        provider: Payment["provider"];
        paidCents: number;
        remainingCents: number;
      }[];
      pending: boolean;
    }
  >();

  for (const purchase of purchases) {
    if (errorsByPurchase.has(purchase.id)) {
      continue;
    }

    const payments = eligibleByPurchase.get(purchase.id) ?? [];

    try {
      const funds = payments.map((payment) => {
        const paidCents = cents(payment.amount);

        const refundedCents = payment.refunds
          .filter((refund) => refund.status === "SUCCEEDED")
          .reduce((sum, refund) => sum + cents(refund.amount), 0);

        const reservedCents = reservedCentsByPayment.get(payment.id) ?? 0;

        const remainingCents = paidCents - refundedCents - reservedCents;

        if (remainingCents < 0) {
          throw new AppError("REFUND_RECONCILIATION_REQUIRED", 409);
        }

        return {
          paymentId: payment.id,
          provider: payment.provider,
          paidCents,
          remainingCents,
        };
      });

      fundingByPurchase.set(purchase.id, {
        payments,
        funds,
        pending: payments.some((payment) => pendingPaymentIds.has(payment.id)),
      });
    } catch (error) {
      if (error instanceof AppError) {
        errorsByPurchase.set(purchase.id, error);
      } else {
        throw error;
      }
    }
  }

  // =====================================================
  // 9. RETURN BATCH DATA
  // =====================================================

  return {
    purchases: purchaseMap,
    reservedCentsByPayment,
    pendingPaymentIds,
    fundingByPurchase,
    errorsByPurchase,
  };
}

async function appointmentEvaluation(
  tx: Prisma.TransactionClient,
  id: string,
  userId: string,
  role: string,
  batch?: Awaited<ReturnType<typeof loadAppointmentRefundBatch>>,
) {
  // =====================================================
  // 1. FETCH APPOINTMENT
  // =====================================================

  const appointment = batch
    ? batch.appointments.get(id)
    : await tx.appointment.findUnique({
        where: { id },
        include: {
          payments: {
            include: {
              refunds: true,
            },
          },
          groupPurchase: true,
        },
      });

  if (!appointment) {
    throw new AppError("Appointment not found", 404);
  }

  // =====================================================
  // 2. ACCESS CONTROL
  // =====================================================

  await access(tx, appointment, userId, role);

  // =====================================================
  // 3. VALIDATE POLICY SNAPSHOT
  // =====================================================

  const snapshot = policyTimeMinutes(appointment.cancellationPolicySnapshot);

  if (!isSnapshot(snapshot)) {
    throw new AppError("LEGACY_POLICY_REVIEW_REQUIRED", 409);
  }

  const group = appointment.groupPurchaseId !== null;

  if (
    (group && snapshot.module !== "GROUP_CANCEL") ||
    (!group && snapshot.module !== "SERVICE")
  ) {
    throw new AppError("POLICY_SNAPSHOT_MISMATCH", 409);
  }

  // =====================================================
  // 4. APPOINTMENT TIME — SAVED TIMEZONE SNAPSHOT
  // =====================================================

  const evaluatedAt = new Date();

  // Resolve timezone only once.
  //
  // New appointments:
  //   Use the persisted appointment timezone.
  //
  // Legacy appointments:
  //   Use the controlled brand timezone fallback.

  const timezone = await appointmentTimezone(tx, appointment.id);

  // Convert the appointment's local date and startTime
  // into its actual UTC instant using the saved timezone.

  const appointmentStartsAt = appointmentTime(
    appointment.date,
    appointment.startTime,
    timezone,
  );

  // Positive: appointment is in the future.
  // Zero: appointment starts now.
  // Negative: appointment start time has passed.

  const ms = appointmentStartsAt.getTime() - evaluatedAt.getTime();

  // =====================================================
  // 5. FUNDING VALIDATION
  // =====================================================

  const fundingPayments = group
    ? []
    : appointment.payments.filter((payment) =>
        ["APPOINTMENT", "APPOINTMENT_DEPOSIT"].includes(payment.purpose),
      );

  let payment: (typeof fundingPayments)[number] | null = null;

  let pending = false;

  if (batch) {
    const eligiblePayments = fundingPayments.filter(
      (item) =>
        ["STRIPE", "WALLET"].includes(item.provider) &&
        ["PAID", "PARTIALLY_REFUNDED"].includes(item.status),
    );

    if (
      eligiblePayments.some(
        (item) =>
          item.currency !== appointment.currency ||
          item.refunds.some((refund) => refund.status === "PENDING"),
      )
    ) {
      throw new AppError("REFUND_RECONCILIATION_REQUIRED", 409);
    }

    if (eligiblePayments.length > 1) {
      throw new AppError("MULTIPLE_PAYMENTS_REQUIRE_MANUAL_REVIEW", 409);
    }

    payment = eligiblePayments[0] ?? null;

    pending = payment ? batch.pendingPaymentIds.has(payment.id) : false;
  } else {
    const result = await funding(tx, fundingPayments);

    payment = result.payment;
    pending = Boolean(result.pending);
  }

  // =====================================================
  // 6. REFUND POLICY CALCULATION
  // =====================================================

  const eligible = payment ? remaining(payment) : 0;

  const calculation = evaluatePolicy(snapshot, eligible, ms);

  assertCurrencyAmount(money(calculation.refundCents), appointment.currency);

  assertCurrencyAmount(money(calculation.deductionCents), appointment.currency);

  let reason = calculation.reason;

  // =====================================================
  // 6.1 APPOINTMENT STATUS
  // =====================================================

  if (!["RESERVED", "CONFIRMED"].includes(appointment.appointmentStatus)) {
    reason = "APPOINTMENT_NOT_CANCELLABLE";
  }

  // =====================================================
  // 6.2 CHECK-IN PROTECTION
  // =====================================================

  if (appointment.qrVerifiedAt !== null) {
    reason = "APPOINTMENT_ALREADY_CHECKED_IN";
  }

  // =====================================================
  // 6.3 EXISTING REFUND REQUEST
  // =====================================================

  if (pending) {
    reason = "REFUND_REQUEST_ALREADY_EXISTS";
  }

  // =====================================================
  // 6.4 GROUP PURCHASE BOOKING RULE
  // =====================================================

  if (group && appointment.bookingMethod !== "GROUP_PURCHASE") {
    reason = "INITIAL_BOOKING_REQUIRES_PURCHASE_REVIEW";
  }

  // =====================================================
  // 6.5 GROUP PURCHASE VALIDATION
  // =====================================================

  if (
    group &&
    (!appointment.groupPurchase ||
      appointment.groupPurchase.customerId !== appointment.customerId ||
      !["PAID", "PARTIALLY_PAID", "UNPAID"].includes(
        appointment.groupPurchase.paymentStatus,
      ))
  ) {
    reason = "GROUP_PURCHASE_NOT_CANCELLABLE";
  }

  // =====================================================
  // 7. REFUND RESPONSE
  // =====================================================

  const refund = {
    eligiblePaidAmount: money(eligible),

    deductionType: calculation.tier?.calculationType ?? null,

    deductionValue:
      calculation.tier?.deductionValue ?? calculation.tier?.value ?? null,

    deductionAmount: money(calculation.deductionCents),

    refundAmount: reason ? 0 : money(calculation.refundCents),

    currency: appointment.currency,

    destination: payment?.provider ?? null,

    paymentId: payment?.id ?? null,

    approvalRequired: !!payment && calculation.refundCents > 0,
  };

  const outcome = reason ? null : calculation.entitlementOutcome;

  // =====================================================
  // 8. PREVIEW TOKEN
  // =====================================================

  // Preserve the existing signature contract.
  //
  // The token is recalculated during cancellation.
  // A separate token-expiry mechanism should be added
  // only after reviewing signature() and confirmationBody.

  const previewPayload = {
    userId,
    id,
    snapshot,
    status: appointment.appointmentStatus,
    updatedAt: appointment.updatedAt,
    eligible,
    reason,
    refund,
    outcome,
  };

  const token = createPolicyPreviewToken(previewPayload, evaluatedAt);
  // =====================================================
  // 9. CANCELLATION DEADLINE
  // =====================================================

  // Use the exact same appointment UTC instant
  // calculated in section 4.
  //
  // This avoids resolving timezone twice and keeps
  // the preview deadline consistent with policy time.

  const cancellationDeadline = new Date(
    appointmentStartsAt.getTime() -
      snapshot.config.minimumCancellationMinutes * 60_000,
  );

  // =====================================================
  // 10. BUILD PREVIEW RESPONSE
  // =====================================================

  const view = {
    appointmentId: id,

    bookingMethod: appointment.bookingMethod,

    canCancel: reason === null,

    reason,

    minutesBeforeAppointment: ms / 60_000,

    policyVersion: snapshot.version,

    cancellationDeadline,

    entitlementOutcome: outcome,

    refund,

    previewToken: token,
  };

  // =====================================================
  // 11. PRESERVE EXISTING RETURN STRUCTURE
  // =====================================================

  return {
    view,
    appointment,
    snapshot,
    payment,
    calculation,
    eligible,
    evaluatedAt,
    previewPayload,
  };
}

async function groupEvaluation(
  tx: Prisma.TransactionClient,
  id: string,
  userId: string,
  batch?: Awaited<ReturnType<typeof loadGroupRefundBatch>>,
) {
  // =====================================================
  // 1. FETCH GROUP PURCHASE
  // =====================================================

  const purchase = batch
    ? batch.purchases.get(id)
    : await tx.groupPurchase.findUnique({
        where: { id },
        include: {
          appointments: true,
          payments: {
            include: {
              refunds: true,
            },
          },
        },
      });

  if (!purchase) {
    throw new AppError("Group purchase not found", 404);
  }

  // =====================================================
  // 2. CUSTOMER ACCESS CONTROL
  // =====================================================

  if (purchase.customerId !== userId) {
    throw new AppError("REFUND_ACCESS_DENIED", 403);
  }

  // =====================================================
  // 3. POLICY SNAPSHOT VALIDATION
  // =====================================================

  const snapshot = policyTimeMinutes(purchase.refundPolicySnapshot);

  if (
    !isSnapshot(snapshot) ||
    snapshot.module !== "GROUP_REFUND" ||
    !purchase.purchaseBranchId
  ) {
    throw new AppError("LEGACY_PURCHASE_BRANCH_REVIEW_REQUIRED", 409);
  }

  // =====================================================
  // 4. CALCULATE GROUP PURCHASE USAGE
  // =====================================================

  const allocated = purchase.appointments.filter(
    (appointment) => appointment.appointmentStatus !== "CANCELLED",
  );

  const activeBookings = allocated.some((appointment) =>
    ["RESERVED", "CONFIRMED", "PENDING_PAYMENT"].includes(
      appointment.appointmentStatus,
    ),
  );

  const remainingQuantity = Math.max(
    0,
    purchase.quantity -
      allocated.length -
      purchase.forfeitedQuantity -
      purchase.refundedQuantity,
  );

  // =====================================================
  // 5. FUNDING VALIDATION — BATCH AWARE
  // =====================================================

  const batchError = batch?.errorsByPurchase.get(purchase.id);

  if (batchError) {
    throw batchError;
  }

  const batchFunding = batch?.fundingByPurchase.get(purchase.id);

  if (batch && !batchFunding) {
    throw new AppError("REFUND_RECONCILIATION_REQUIRED", 409);
  }

  // Normal preview/refund execution continues using
  // groupRefundFunding() with fresh database validation.

  const funding = batchFunding
    ? batchFunding
    : await groupRefundFunding(tx, purchase.id, purchase.customerId);

  const { payments, funds, pending } = funding;

  // =====================================================
  // 6. FIND REFUND SOURCE PAYMENT
  // =====================================================

  const remainingByPayment = new Map(
    funds.map((fund) => [fund.paymentId, fund.remainingCents]),
  );

  const payment =
    payments.find((item) => (remainingByPayment.get(item.id) ?? 0) > 0) ?? null;

  // =====================================================
  // 7. CALCULATE REFUNDABLE BALANCE
  // =====================================================

  const eligible = payment
    ? Math.min(
        funds.reduce((sum, fund) => sum + fund.remainingCents, 0),
        new Prisma.Decimal(funds.reduce((sum, fund) => sum + fund.paidCents, 0))
          .mul(remainingQuantity)
          .div(purchase.quantity)
          .toDecimalPlaces(0, Prisma.Decimal.ROUND_DOWN)
          .toNumber(),
      )
    : 0;

  // =====================================================
  // 8. EVALUATE POLICY
  // =====================================================

  const evaluatedAt = new Date();

  const age = purchase.purchasedAt
    ? evaluatedAt.getTime() - purchase.purchasedAt.getTime()
    : 0;

  const calculation = evaluatePolicy(snapshot, eligible, age);
  const purchaseCurrency = await getPurchaseCurrency(tx, purchase.id);
  assertCurrencyAmount(money(calculation.refundCents), purchaseCurrency);
  assertCurrencyAmount(money(calculation.deductionCents), purchaseCurrency);

  let reason = calculation.reason;

  if (
    !["PAID", "PARTIALLY_REFUNDED"].includes(purchase.paymentStatus) ||
    !purchase.purchasedAt
  ) {
    reason = "GROUP_PURCHASE_NOT_PAID";
  }

  if (purchaseExpired(purchase) && !snapshot.config.allowExpiredRefund) {
    reason = "GROUP_PURCHASE_EXPIRED";
  }

  if (
    !snapshot.config.allowPartiallyUsedRefund &&
    (allocated.length > 0 || purchase.forfeitedQuantity > 0)
  ) {
    reason = "USED_GROUP_PURCHASE_NOT_REFUNDABLE";
  }

  if (activeBookings) {
    reason = "ACTIVE_APPOINTMENT_RESOLUTION_REQUIRED";
  }

  if (remainingQuantity <= 0 || eligible <= 0 || calculation.refundCents <= 0) {
    reason = "NO_REFUNDABLE_BALANCE";
  }

  if (pending) {
    reason = "REFUND_REQUEST_ALREADY_EXISTS";
  }

  // =====================================================
  // 9. BUILD REFUND DETAILS
  // =====================================================

  const refund = {
    eligiblePaidAmount: money(eligible),

    deductionAmount: money(calculation.deductionCents),

    refundAmount: reason ? 0 : money(calculation.refundCents),

    currency: await getPurchaseCurrency(tx, purchase.id),

    destination: payment?.provider ?? null,

    paymentId: payment?.id ?? null,

    destinations: funds.map((fund) => ({
      paymentId: fund.paymentId,
      provider: fund.provider,
      availableAmount: money(fund.remainingCents),
    })),

    approvalRequired: true,
  };

  // =====================================================
  // 10. GENERATE PREVIEW TOKEN
  // =====================================================

  const previewPayload = {
    userId,
    id,
    snapshot,
    status: purchase.paymentStatus,
    updatedAt: purchase.updatedAt,
    quantity: remainingQuantity,
    eligible,
    reason,
    tier: calculation.tier,
    refund,
  };

  const token = createPolicyPreviewToken(previewPayload, evaluatedAt);

  // =====================================================
  // 11. BUILD RESPONSE VIEW
  // =====================================================

  const view = {
    purchaseId: id,

    canRequestRefund: reason === null,

    reason,

    purchaseAgeMinutes: age / 60000,

    purchasedQuantity: purchase.quantity,

    usedQuantity: allocated.length,

    forfeitedQuantity: purchase.forfeitedQuantity,

    refundedQuantity: purchase.refundedQuantity,

    remainingRefundableQuantity: remainingQuantity,

    applicableTier: calculation.tier,

    policyVersion: snapshot.version,

    refund,

    previewToken: token,
  };

  // =====================================================
  // 12. PRESERVE EXISTING RETURN STRUCTURE
  // =====================================================

  return {
    view,
    purchase,
    payment,
    snapshot,
    calculation,
    eligible,
    remainingQuantity,
    evaluatedAt,
    funds,
    previewPayload,
  };
}

export const previewAppointment = (
  id: string,
  userId: string,
  role: string = Role.CUSTOMER,
) =>
  prisma.$transaction((tx) =>
    appointmentEvaluation(tx, id, userId, role).then((r) => r.view),
  );
export const previewGroupRefund = (id: string, userId: string) =>
  prisma.$transaction((tx) =>
    groupEvaluation(tx, id, userId).then((r) => r.view),
  );
async function createRequest(
  tx: Prisma.TransactionClient,
  customerId: string,
  paymentId: string,
  reason: string,
  key: string,
  snapshot: ExecutionSnapshot,
) {
  await tx.$queryRaw`SELECT "id" FROM "Payment" WHERE "id"=${paymentId} FOR UPDATE`;
  if (
    await tx.refundRequest.findFirst({
      where: { paymentId, status: { in: [...active] } },
    })
  )
    throw new AppError("REFUND_REQUEST_ALREADY_EXISTS", 409);
  const request = await tx.refundRequest.create({
    data: {
      customerId,
      paymentId,
      reason,
      amount: money(snapshot.calculation.refundCents),
      status: "PENDING",
      requestType:
        snapshot.resourceType === "SERVICE"
          ? "APPOINTMENT_CANCELLATION"
          : "GROUP_PURCHASE_REFUND",
      idempotencyKey: key,
      policySnapshot: json(snapshot),
      policyVersion: snapshot.policy.version,
      eligiblePaidAmount: money(snapshot.calculation.eligibleCents),
      refundDeduction: money(snapshot.calculation.deductionCents),
      isCancellationOnly: false,
      policyEvaluatedAt: new Date(snapshot.evaluatedAt),
    },
  });
  if (snapshot.funding?.length) {
    for (const fund of snapshot.funding) {
      const id = randomUUID();
      await tx.refundAllocation.create({
        data: {
          id,
          refundRequestId: request.id,
          paymentId: fund.paymentId,
          amount: money(fund.amountCents),
          provider: fund.provider as PaymentProvider,
          idempotencyKey: `refund-allocation-${id}`,
        },
      });
    }
  }
  await auditLogService.createAuditLog(
    {
      userId: customerId,
      action: "POLICY_REFUND_REQUEST_CREATED",
      entityType: "REFUND_REQUEST",
      entityId: request.id,
      metadata: {
        paymentId,
        amount: Number(request.amount),
        resourceId: snapshot.resourceId,
      },
    },
    tx,
  );
  return request;
}

export async function cancelWithPolicy(
  id: string,
  userId: string,
  role: string,
  body: Confirmation,
) {
  // =====================================================
  // 1. VALIDATE CONFIRMATION INPUT
  // =====================================================

  const input = confirmationBody.parse(body);

  const key = `cancel:${userId}:${input.idempotencyKey}`;

  return prisma.$transaction(
    async (tx) => {
      // =====================================================
      // 2. FIND GROUP PURCHASE REFERENCE
      // =====================================================

      const initial = await tx.appointment.findUnique({
        where: { id },
        select: {
          groupPurchaseId: true,
        },
      });

      // =====================================================
      // 3. LOCK GROUP PURCHASE FIRST
      // =====================================================

      if (initial?.groupPurchaseId) {
        await tx.$queryRaw`
          SELECT "id"
          FROM "GroupPurchase"
          WHERE "id" = ${initial.groupPurchaseId}
          FOR UPDATE
        `;
      }

      // =====================================================
      // 4. LOCK APPOINTMENT
      // =====================================================

      await tx.$queryRaw`
        SELECT "id"
        FROM "Appointment"
        WHERE "id" = ${id}
        FOR UPDATE
      `;

      // =====================================================
      // 5. FETCH LATEST APPOINTMENT
      // =====================================================

      const old = await tx.appointment.findUnique({
        where: { id },
      });

      if (!old) {
        throw new AppError("Appointment not found", 404);
      }

      // =====================================================
      // 6. ACCESS CONTROL
      // =====================================================

      await access(tx, old, userId, role);

      // =====================================================
      // 7. IDEMPOTENCY PROTECTION
      // =====================================================

      // A successfully completed cancellation must
      // return its original response on retry.
      //
      // Token expiry must not break idempotent retries.

      if (old.cancellationIdempotencyKey === key && old.cancellationResult) {
        if (old.cancellationReason !== input.reason) {
          throw new AppError("IDEMPOTENCY_KEY_CONFLICT", 409);
        }

        return old.cancellationResult;
      }

      // =====================================================
      // 8. CHECK-IN PROTECTION
      // =====================================================

      if (old.qrVerifiedAt !== null) {
        throw new AppError(
          "Appointment cannot be cancelled because the customer has already checked in",
          409,
        );
      }

      // =====================================================
      // 9. RE-EVALUATE CANCELLATION POLICY
      // =====================================================

      // This uses the saved appointment timezone,
      // policy snapshot and latest funding state.

      const result = await appointmentEvaluation(tx, id, userId, role);

      if (!result.view.canCancel) {
        throw new AppError(
          result.view.reason ?? "CANCELLATION_NOT_ALLOWED",
          409,
        );
      }

      // =====================================================
      // 10. VERIFY SIGNED PREVIEW TOKEN
      // =====================================================

      // Validates:
      // - HMAC signature
      // - Token expiry
      // - User and appointment identity
      // - Current policy snapshot
      // - Current appointment status
      // - Current refund calculation
      // - Current entitlement outcome

      verifyPolicyPreviewToken(input.previewToken, result.previewPayload);

      // =====================================================
      // 11. EXTRACT EVALUATION RESULT
      // =====================================================

      const { appointment, snapshot, payment, calculation } = result;

      let request = null;

      // =====================================================
      // 12. CREATE REFUND REQUEST
      // =====================================================

      if (payment && calculation.refundCents > 0) {
        request = await createRequest(
          tx,
          appointment.customerId,
          payment.id,
          input.reason,
          `appointment:${key}`,
          {
            engine: "MERCHANT_V1",
            resourceType: "SERVICE",
            resourceId: id,
            policy: snapshot,
            evaluatedAt: result.evaluatedAt.toISOString(),
            refundableQuantity: 0,
            calculation: {
              eligibleCents: result.eligible,
              deductionCents: calculation.deductionCents,
              refundCents: calculation.refundCents,
            },
          },
        );
      }

      // =====================================================
      // 13. GROUP PURCHASE FORFEITURE
      // =====================================================

      if (
        appointment.groupPurchaseId &&
        calculation.entitlementOutcome === "FORFEITED"
      ) {
        await tx.groupPurchase.update({
          where: {
            id: appointment.groupPurchaseId,
          },
          data: {
            forfeitedQuantity: {
              increment: 1,
            },
          },
        });
      }

      // =====================================================
      // 14. GROUP PURCHASE ENTITLEMENT SUMMARY
      // =====================================================

      let groupPurchase;

      if (appointment.groupPurchaseId) {
        const purchase = await tx.groupPurchase.findUniqueOrThrow({
          where: {
            id: appointment.groupPurchaseId,
          },
        });

        const allocations = await tx.appointment.count({
          where: {
            groupPurchaseId: purchase.id,
            id: {
              not: id,
            },
            appointmentStatus: {
              not: "CANCELLED",
            },
          },
        });

        groupPurchase = {
          purchaseId: purchase.id,

          purchasedQuantity: purchase.quantity,

          redeemedQuantity: allocations,

          remainingQuantity: Math.max(
            0,
            purchase.quantity -
              purchase.forfeitedQuantity -
              purchase.refundedQuantity -
              allocations,
          ),
        };
      }

      // =====================================================
      // 15. BUILD IDEMPOTENT RESPONSE
      // =====================================================

      const response = {
        appointmentId: id,

        appointmentStatus: "CANCELLED",

        refundStatus: request ? "PENDING_APPROVAL" : "NOT_REQUIRED",

        refundRequestId: request?.id ?? null,

        refundAmount: request ? Number(request.amount) : 0,

        entitlementOutcome: calculation.entitlementOutcome,

        ...(groupPurchase && {
          groupPurchase,
        }),
      };

      // =====================================================
      // 16. ATOMIC APPOINTMENT CANCELLATION
      // =====================================================

      const changed = await tx.appointment.updateMany({
        where: {
          id,

          appointmentStatus: {
            in: ["RESERVED", "CONFIRMED"],
          },

          qrVerifiedAt: null,
        },

        data: {
          appointmentStatus: "CANCELLED",

          cancelledAt: new Date(),

          cancellationReason: input.reason,

          qrToken: null,

          cancellationIdempotencyKey: key,

          cancellationResult: json(response),

          ...(calculation.entitlementOutcome && {
            entitlementCancellationOutcome: calculation.entitlementOutcome,
          }),
        },
      });

      if (changed.count !== 1) {
        throw new AppError("CANCELLATION_CONFLICT", 409);
      }

      // =====================================================
      // 17. AUDIT LOG
      // =====================================================

      await auditLogService.createAuditLog(
        {
          userId,

          action: "POLICY_APPOINTMENT_CANCELLED",

          entityType: "APPOINTMENT",

          entityId: id,

          metadata: {
            refundRequestId: request?.id ?? null,

            entitlementOutcome: calculation.entitlementOutcome,
          },
        },
        tx,
      );

      // =====================================================
      // 18. CUSTOMER NOTIFICATION
      // =====================================================

      await notificationService.createNotification(
        {
          userId: appointment.customerId,

          appointmentId: id,

          type: "BOOKING_CANCELLED",

          title: "Appointment cancelled",

          message: request
            ? "Your appointment was cancelled. Your refund is awaiting merchant approval."
            : "Your appointment has been cancelled.",

          translations: notificationTemplates.POLICY_BOOKING_CANCELLED(
            Boolean(request),
          ),
        },
        tx,
      );

      // =====================================================
      // 19. RETURN RESPONSE
      // =====================================================

      return response;
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,

      timeout: 15000,
    },
  );
}

export async function requestGroupRefund(
  id: string,
  userId: string,
  body: Confirmation,
) {
  // =====================================================
  // 1. VALIDATE CONFIRMATION INPUT
  // =====================================================

  const input = confirmationBody.parse(body);

  const key = `group:${userId}:${input.idempotencyKey}`;

  return prisma.$transaction(
    async (tx) => {
      // =====================================================
      // 2. LOCK GROUP PURCHASE
      // =====================================================

      await tx.$queryRaw`
        SELECT "id"
        FROM "GroupPurchase"
        WHERE "id" = ${id}
        FOR UPDATE
      `;

      // =====================================================
      // 3. IDEMPOTENCY CHECK
      // =====================================================

      const existing = await tx.refundRequest.findUnique({
        where: {
          idempotencyKey: key,
        },
      });

      if (existing) {
        const saved = executionSnapshot(existing.policySnapshot);

        if (
          existing.customerId !== userId ||
          saved?.resourceId !== id ||
          existing.reason !== input.reason
        ) {
          throw new AppError("IDEMPOTENCY_KEY_CONFLICT", 409);
        }

        // Return original request even when the
        // preview token has subsequently expired.

        return existing;
      }

      // =====================================================
      // 4. RE-EVALUATE GROUP REFUND POLICY
      // =====================================================

      const result = await groupEvaluation(tx, id, userId);

      // =====================================================
      // 5. VALIDATE REFUND ELIGIBILITY
      // =====================================================

      if (!result.view.canRequestRefund || !result.payment) {
        throw new AppError(result.view.reason ?? "NO_REFUNDABLE_BALANCE", 409);
      }

      // =====================================================
      // 6. VERIFY SIGNED PREVIEW TOKEN
      // =====================================================

      // Validates:
      // - HMAC signature
      // - Token expiry
      // - Customer and purchase identity
      // - Latest policy snapshot
      // - Remaining refundable quantity
      // - Current refund amount
      // - Current funding state represented in preview

      verifyPolicyPreviewToken(input.previewToken, result.previewPayload);

      // =====================================================
      // 7. PREPARE REFUND FUNDING ALLOCATION
      // =====================================================

      const funding =
        result.funds.length > 1
          ? {
              funding: allocateRefund(
                result.funds,
                result.calculation.refundCents,
              ).map((allocation) => ({
                ...allocation,

                paidCents: result.funds.find(
                  (fund) => fund.paymentId === allocation.paymentId,
                )!.paidCents,
              })),
            }
          : {};

      // =====================================================
      // 8. CREATE GROUP REFUND REQUEST
      // =====================================================

      return createRequest(tx, userId, result.payment.id, input.reason, key, {
        engine: "MERCHANT_V1",

        resourceType: "GROUP_REFUND",

        resourceId: id,

        policy: result.snapshot,

        evaluatedAt: result.evaluatedAt.toISOString(),

        refundableQuantity: result.remainingQuantity,

        ...funding,

        calculation: {
          eligibleCents: result.eligible,

          deductionCents: result.calculation.deductionCents,

          refundCents: result.calculation.refundCents,
        },
      });
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,

      timeout: 15000,
    },
  );
}

export const getPaymentRefundEligibility = async (
  customerId: string,
  payment: {
    id: string;
    purpose: string;
    status: string;
    appointmentId: string | null;
    groupPurchaseId: string | null;
  },
): Promise<{
  canRefund: boolean;
  refundBlockedReason: string | null;
}> => {
  // Only settled payments can be refunded.
  if (!["PAID", "PARTIALLY_REFUNDED"].includes(payment.status)) {
    return {
      canRefund: false,
      refundBlockedReason: "PAYMENT_NOT_PAID",
    };
  }

  // Wallet top-up is not refundable through
  // the appointment/group purchase refund workflow.
  if (payment.purpose === "WALLET_TOP_UP") {
    return {
      canRefund: false,
      refundBlockedReason: "NOT_REFUNDABLE_PURPOSE",
    };
  }

  // Appointment remaining payment is not currently
  // covered by appointmentEvaluation funding selection.
  if (payment.purpose === "APPOINTMENT_REMAINING") {
    return {
      canRefund: false,
      refundBlockedReason: "REFUND_REVIEW_REQUIRED",
    };
  }

  try {
    if (
      ["APPOINTMENT", "APPOINTMENT_DEPOSIT"].includes(payment.purpose) &&
      payment.appointmentId
    ) {
      const result = await prisma.$transaction((tx) =>
        appointmentEvaluation(
          tx,
          payment.appointmentId!,
          customerId,
          Role.CUSTOMER,
        ),
      );

      const isEvaluatedPayment = result.view.refund.paymentId === payment.id;

      const refundableAmount = result.view.refund.refundAmount;

      return {
        canRefund:
          isEvaluatedPayment && result.view.canCancel && refundableAmount > 0,

        refundBlockedReason: !isEvaluatedPayment
          ? "PAYMENT_NOT_REFUND_SOURCE"
          : (result.view.reason ??
            (refundableAmount <= 0 ? "NO_REFUNDABLE_BALANCE" : null)),
      };
    }

    if (payment.purpose === "GROUP_PURCHASE" && payment.groupPurchaseId) {
      const result = await prisma.$transaction((tx) =>
        groupEvaluation(tx, payment.groupPurchaseId!, customerId),
      );

      const isEvaluatedPayment = result.view.refund.paymentId === payment.id;

      const refundableAmount = result.view.refund.refundAmount;

      return {
        canRefund:
          isEvaluatedPayment &&
          result.view.canRequestRefund &&
          refundableAmount > 0,

        refundBlockedReason: !isEvaluatedPayment
          ? "PAYMENT_NOT_REFUND_SOURCE"
          : (result.view.reason ??
            (refundableAmount <= 0 ? "NO_REFUNDABLE_BALANCE" : null)),
      };
    }

    return {
      canRefund: false,
      refundBlockedReason: "NOT_REFUNDABLE_PURPOSE",
    };
  } catch (error) {
    // Known policy/reconciliation errors should block
    // the refund button without failing payment history.
    if (error instanceof AppError) {
      if (error.statusCode === 409) {
        return {
          canRefund: false,
          refundBlockedReason: error.message,
        };
      }
    }

    throw error;
  }
};

export const getPaymentsRefundEligibilityBatch = async (
  customerId: string,
  payments: {
    id: string;
    purpose: string;
    status: string;
    appointmentId: string | null;
    groupPurchaseId: string | null;
  }[],
): Promise<
  Map<
    string,
    {
      canRefund: boolean;
      refundBlockedReason: string | null;
    }
  >
> => {
  type Eligibility = {
    canRefund: boolean;
    refundBlockedReason: string | null;
  };

  const results = new Map<string, Eligibility>();

  if (payments.length === 0) {
    return results;
  }

  // =====================================================
  // 1. COLLECT UNIQUE APPOINTMENT IDS
  // =====================================================

  const appointmentIds = [
    ...new Set(
      payments
        .filter(
          (payment) =>
            ["PAID", "PARTIALLY_REFUNDED"].includes(payment.status) &&
            ["APPOINTMENT", "APPOINTMENT_DEPOSIT"].includes(payment.purpose) &&
            payment.appointmentId !== null,
        )
        .map((payment) => payment.appointmentId!),
    ),
  ];

  // =====================================================
  // 2. COLLECT UNIQUE GROUP PURCHASE IDS
  // =====================================================

  const groupPurchaseIds = [
    ...new Set(
      payments
        .filter(
          (payment) =>
            ["PAID", "PARTIALLY_REFUNDED"].includes(payment.status) &&
            payment.purpose === "GROUP_PURCHASE" &&
            payment.groupPurchaseId !== null,
        )
        .map((payment) => payment.groupPurchaseId!),
    ),
  ];

  // =====================================================
  // 3. BATCH LOAD REFUND DATA
  // =====================================================

  // Load appointment and group funding in the same
  // read-only transaction to reduce repeated queries.

  const { appointmentBatch, groupBatch } = await prisma.$transaction(
    async (tx) => {
      const appointmentBatch = await loadAppointmentRefundBatch(
        tx,
        appointmentIds,
      );

      const groupBatch = await loadGroupRefundBatch(tx, groupPurchaseIds);

      return {
        appointmentBatch,
        groupBatch,
      };
    },
  );

  // =====================================================
  // 4. CACHE EVALUATIONS PER RESOURCE
  // =====================================================

  const appointmentCache = new Map<
    string,
    Promise<Awaited<ReturnType<typeof appointmentEvaluation>>>
  >();

  const groupCache = new Map<
    string,
    Promise<Awaited<ReturnType<typeof groupEvaluation>>>
  >();

  // =====================================================
  // 5. EVALUATE PAYMENT ELIGIBILITY
  // =====================================================

  const evaluate = async (
    payment: (typeof payments)[number],
  ): Promise<Eligibility> => {
    if (!["PAID", "PARTIALLY_REFUNDED"].includes(payment.status)) {
      return {
        canRefund: false,
        refundBlockedReason: "PAYMENT_NOT_PAID",
      };
    }

    if (payment.purpose === "WALLET_TOP_UP") {
      return {
        canRefund: false,
        refundBlockedReason: "NOT_REFUNDABLE_PURPOSE",
      };
    }

    if (payment.purpose === "APPOINTMENT_REMAINING") {
      return {
        canRefund: false,
        refundBlockedReason: "REFUND_REVIEW_REQUIRED",
      };
    }

    try {
      // ================================================
      // APPOINTMENT PAYMENT
      // ================================================

      if (
        ["APPOINTMENT", "APPOINTMENT_DEPOSIT"].includes(payment.purpose) &&
        payment.appointmentId
      ) {
        const appointmentId = payment.appointmentId;

        let evaluation = appointmentCache.get(appointmentId);

        if (!evaluation) {
          evaluation = prisma.$transaction((tx) =>
            appointmentEvaluation(
              tx,
              appointmentId,
              customerId,
              Role.CUSTOMER,
              appointmentBatch,
            ),
          );

          appointmentCache.set(appointmentId, evaluation);
        }

        const { view } = await evaluation;

        const isSource = view.refund.paymentId === payment.id;

        const refundableAmount = view.refund.refundAmount;

        return {
          canRefund: isSource && view.canCancel && refundableAmount > 0,

          refundBlockedReason: !isSource
            ? "PAYMENT_NOT_REFUND_SOURCE"
            : (view.reason ??
              (refundableAmount <= 0 ? "NO_REFUNDABLE_BALANCE" : null)),
        };
      }

      // ================================================
      // GROUP PURCHASE PAYMENT
      // ================================================

      if (payment.purpose === "GROUP_PURCHASE" && payment.groupPurchaseId) {
        const purchaseId = payment.groupPurchaseId;

        let evaluation = groupCache.get(purchaseId);

        if (!evaluation) {
          evaluation = prisma.$transaction((tx) =>
            groupEvaluation(tx, purchaseId, customerId, groupBatch),
          );

          groupCache.set(purchaseId, evaluation);
        }

        const { view } = await evaluation;

        const isSource = view.refund.paymentId === payment.id;

        const refundableAmount = view.refund.refundAmount;

        return {
          canRefund: isSource && view.canRequestRefund && refundableAmount > 0,

          refundBlockedReason: !isSource
            ? "PAYMENT_NOT_REFUND_SOURCE"
            : (view.reason ??
              (refundableAmount <= 0 ? "NO_REFUNDABLE_BALANCE" : null)),
        };
      }

      return {
        canRefund: false,
        refundBlockedReason: "NOT_REFUNDABLE_PURPOSE",
      };
    } catch (error) {
      if (error instanceof AppError && error.statusCode === 409) {
        return {
          canRefund: false,
          refundBlockedReason: error.message,
        };
      }

      throw error;
    }
  };

  // =====================================================
  // 6. RESOLVE ELIGIBILITY RESULTS
  // =====================================================

  const eligibilityResults = await Promise.all(
    payments.map(async (payment) => ({
      paymentId: payment.id,
      eligibility: await evaluate(payment),
    })),
  );

  // =====================================================
  // 7. BUILD RESPONSE MAP
  // =====================================================

  for (const result of eligibilityResults) {
    results.set(result.paymentId, result.eligibility);
  }

  return results;
};
