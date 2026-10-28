import { createHmac } from "node:crypto";
import { Prisma, Role } from "../../../../generated/prisma/client.js";
import config from "../../config/index.js";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../utils/app-error.js";
import { auditLogService } from "../auditLog/auditLog.service.js";
import { enqueueAppointmentEmail } from '../brand-email-setting/brand-email-setting.events.js';
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
import { purchaseExpired } from "./policy.snapshot.js";
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
        p.currency !== "HKD" ||
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
async function appointmentEvaluation(
  tx: Prisma.TransactionClient,
  id: string,
  userId: string,
  role: string,
) {
  const appointment = await tx.appointment.findUnique({
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

  await access(tx, appointment, userId, role);

  const snapshot = appointment.cancellationPolicySnapshot;

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

  const evaluatedAt = new Date();

  const ms =
    appointmentTime(appointment.date, appointment.startTime).getTime() -
    evaluatedAt.getTime();

  const { payment, pending } = await funding(
    tx,
    group
      ? []
      : appointment.payments.filter((p) =>
          ["APPOINTMENT", "APPOINTMENT_DEPOSIT"].some(
            (purpose) => purpose === p.purpose,
          ),
        ),
  );

  const eligible = payment ? remaining(payment) : 0;

  const calculation = evaluatePolicy(snapshot, eligible, ms);

  let reason = calculation.reason;

  // Existing appointment status validation
  if (!["RESERVED", "CONFIRMED"].includes(appointment.appointmentStatus)) {
    reason = "APPOINTMENT_NOT_CANCELLABLE";
  }

  // NEW: Prevent cancellation after QR check-in
  if (appointment.qrVerifiedAt !== null) {
    reason = "APPOINTMENT_ALREADY_CHECKED_IN";
  }

  // Existing refund request validation
  if (pending) {
    reason = "REFUND_REQUEST_ALREADY_EXISTS";
  }

  // Initial Direct Booking is the QR/salon settlement anchor.
  // Cancelling it requires separate whole-purchase processing.
  if (group && appointment.bookingMethod !== "GROUP_PURCHASE") {
    reason = "INITIAL_BOOKING_REQUIRES_PURCHASE_REVIEW";
  }

  // Existing group purchase validation
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

  const refund = {
    eligiblePaidAmount: money(eligible),

    deductionType: calculation.tier?.calculationType ?? null,

    deductionValue:
      calculation.tier?.deductionValue ?? calculation.tier?.value ?? null,

    deductionAmount: money(calculation.deductionCents),

    refundAmount: reason ? 0 : money(calculation.refundCents),

    currency: "HKD",

    destination: payment?.provider ?? null,

    paymentId: payment?.id ?? null,

    approvalRequired: !!payment && calculation.refundCents > 0,
  };

  const outcome = reason ? null : calculation.entitlementOutcome;

  const token = signature({
    userId,
    id,
    snapshot,
    status: appointment.appointmentStatus,
    updatedAt: appointment.updatedAt,
    eligible,
    reason,
    refund,
    outcome,
  });

  const view = {
    appointmentId: id,

    bookingMethod: appointment.bookingMethod,

    canCancel: reason === null,

    reason,

    hoursBeforeAppointment: ms / 3600000,

    policyVersion: snapshot.version,

    cancellationDeadline: new Date(
      appointmentTime(appointment.date, appointment.startTime).getTime() -
        snapshot.config.minimumCancellationHours * 3600000,
    ),

    entitlementOutcome: outcome,

    refund,

    previewToken: token,
  };

  return {
    view,
    appointment,
    snapshot,
    payment,
    calculation,
    eligible,
    evaluatedAt,
  };
}
async function groupEvaluation(
  tx: Prisma.TransactionClient,
  id: string,
  userId: string,
) {
  const purchase = await tx.groupPurchase.findUnique({
    where: { id },
    include: { appointments: true, payments: { include: { refunds: true } } },
  });
  if (!purchase) throw new AppError("Group purchase not found", 404);
  if (purchase.customerId !== userId)
    throw new AppError("REFUND_ACCESS_DENIED", 403);
  const snapshot = purchase.refundPolicySnapshot;
  if (
    !isSnapshot(snapshot) ||
    snapshot.module !== "GROUP_REFUND" ||
    !purchase.purchaseBranchId
  )
    throw new AppError("LEGACY_PURCHASE_BRANCH_REVIEW_REQUIRED", 409);
  const allocated = purchase.appointments.filter(
    (a) => a.appointmentStatus !== "CANCELLED",
  );
  const activeBookings = allocated.some((a) =>
    ["RESERVED", "CONFIRMED", "PENDING_PAYMENT"].includes(a.appointmentStatus),
  );
  const remainingQuantity = Math.max(
    0,
    purchase.quantity -
      allocated.length -
      purchase.forfeitedQuantity -
      purchase.refundedQuantity,
  );
  const { payment, pending } = await funding(
    tx,
    purchase.payments.filter((p) => p.purpose === "GROUP_PURCHASE"),
  );
  const eligible = payment
    ? Math.min(
        remaining(payment),
        new Prisma.Decimal(cents(payment.amount))
          .mul(remainingQuantity)
          .div(purchase.quantity)
          .toDecimalPlaces(0, Prisma.Decimal.ROUND_DOWN)
          .toNumber(),
      )
    : 0;
  const evaluatedAt = new Date();
  const age = purchase.purchasedAt
    ? evaluatedAt.getTime() - purchase.purchasedAt.getTime()
    : 0;
  const calculation = evaluatePolicy(snapshot, eligible, age);
  let reason = calculation.reason;
  if (
    !["PAID", "PARTIALLY_REFUNDED"].includes(purchase.paymentStatus) ||
    !purchase.purchasedAt
  )
    reason = "GROUP_PURCHASE_NOT_PAID";
  if (purchaseExpired(purchase) && !snapshot.config.allowExpiredRefund)
    reason = "GROUP_PURCHASE_EXPIRED";
  if (
    !snapshot.config.allowPartiallyUsedRefund &&
    (allocated.length > 0 || purchase.forfeitedQuantity > 0)
  )
    reason = "USED_GROUP_PURCHASE_NOT_REFUNDABLE";
  if (activeBookings) reason = "ACTIVE_APPOINTMENT_RESOLUTION_REQUIRED";
  if (remainingQuantity <= 0 || eligible <= 0 || calculation.refundCents <= 0)
    reason = "NO_REFUNDABLE_BALANCE";
  if (pending) reason = "REFUND_REQUEST_ALREADY_EXISTS";
  const refund = {
    eligiblePaidAmount: money(eligible),
    deductionAmount: money(calculation.deductionCents),
    refundAmount: reason ? 0 : money(calculation.refundCents),
    currency: "HKD",
    destination: payment?.provider ?? null,
    paymentId: payment?.id ?? null,
    approvalRequired: true,
  };
  const token = signature({
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
  });
  const view = {
    purchaseId: id,
    canRequestRefund: reason === null,
    reason,
    purchaseAgeHours: age / 3600000,
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
  return {
    view,
    purchase,
    payment,
    snapshot,
    calculation,
    eligible,
    remainingQuantity,
    evaluatedAt,
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
  const input = confirmationBody.parse(body);
  const key = `cancel:${userId}:${input.idempotencyKey}`;

  return prisma.$transaction(
    async (tx) => {
      const initial = await tx.appointment.findUnique({
        where: { id },
        select: { groupPurchaseId: true },
      });

      if (initial?.groupPurchaseId) {
        await tx.$queryRaw`
          SELECT "id"
          FROM "GroupPurchase"
          WHERE "id" = ${initial.groupPurchaseId}
          FOR UPDATE
        `;
      }

      await tx.$queryRaw`
        SELECT "id"
        FROM "Appointment"
        WHERE "id" = ${id}
        FOR UPDATE
      `;

      const old = await tx.appointment.findUnique({
        where: { id },
      });

      if (!old) {
        throw new AppError("Appointment not found", 404);
      }

      await access(tx, old, userId, role);

      // Already completed requests retain their idempotent response.
      if (old.cancellationIdempotencyKey === key && old.cancellationResult) {
        if (old.cancellationReason !== input.reason) {
          throw new AppError("IDEMPOTENCY_KEY_CONFLICT", 409);
        }

        return old.cancellationResult;
      }

      // Block cancellation after customer check-in.
      if (old.qrVerifiedAt !== null) {
        throw new AppError(
          "Appointment cannot be cancelled because the customer has already checked in",
          409,
        );
      }

      const result = await appointmentEvaluation(tx, id, userId, role);

      if (!result.view.canCancel) {
        throw new AppError(result.view.reason!, 409);
      }

      if (input.previewToken !== result.view.previewToken) {
        throw new AppError("POLICY_PREVIEW_STALE", 409);
      }

      const { appointment, snapshot, payment, calculation } = result;

      let request = null;

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

      if (
        appointment.groupPurchaseId &&
        calculation.entitlementOutcome === "FORFEITED"
      ) {
        await tx.groupPurchase.update({
          where: { id: appointment.groupPurchaseId },
          data: {
            forfeitedQuantity: { increment: 1 },
          },
        });
      }

      let groupPurchase;

      if (appointment.groupPurchaseId) {
        const purchase = await tx.groupPurchase.findUniqueOrThrow({
          where: { id: appointment.groupPurchaseId },
        });

        const allocations = await tx.appointment.count({
          where: {
            groupPurchaseId: purchase.id,
            id: { not: id },
            appointmentStatus: { not: "CANCELLED" },
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

      const response = {
        appointmentId: id,
        appointmentStatus: "CANCELLED",
        refundStatus: request ? "PENDING_APPROVAL" : "NOT_REQUIRED",
        refundRequestId: request?.id ?? null,
        refundAmount: request ? Number(request.amount) : 0,
        entitlementOutcome: calculation.entitlementOutcome,
        ...(groupPurchase && { groupPurchase }),
      };

      // Atomic protection: checked-in appointments cannot be cancelled.
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
      await enqueueAppointmentEmail(tx, id, 'BOOKING_CANCELLED');

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

      await notificationService.createNotification(
        {
          userId: appointment.customerId,
          appointmentId: id,
          type: "BOOKING_CANCELLED",
          title: "Appointment cancelled",
          message: request
            ? "Your appointment was cancelled. Your refund is awaiting merchant approval."
            : "Your appointment has been cancelled.",
        },
        tx,
      );

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
  const input = confirmationBody.parse(body),
    key = `group:${userId}:${input.idempotencyKey}`;
  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "GroupPurchase" WHERE "id"=${id} FOR UPDATE`;
      const existing = await tx.refundRequest.findUnique({
        where: { idempotencyKey: key },
      });
      if (existing) {
        const saved = executionSnapshot(existing.policySnapshot);
        if (
          existing.customerId !== userId ||
          saved?.resourceId !== id ||
          existing.reason !== input.reason
        )
          throw new AppError("IDEMPOTENCY_KEY_CONFLICT", 409);
        return existing;
      }
      const result = await groupEvaluation(tx, id, userId);
      if (!result.view.canRequestRefund || !result.payment)
        throw new AppError(result.view.reason ?? "NO_REFUNDABLE_BALANCE", 409);
      if (input.previewToken !== result.view.previewToken)
        throw new AppError("POLICY_PREVIEW_STALE", 409);
      return createRequest(tx, userId, result.payment.id, input.reason, key, {
        engine: "MERCHANT_V1",
        resourceType: "GROUP_REFUND",
        resourceId: id,
        policy: result.snapshot,
        evaluatedAt: result.evaluatedAt.toISOString(),
        refundableQuantity: result.remainingQuantity,
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
