import { validatePolicyRefund, finalizePolicyGroupRefund, recordPolicyRefundCompletion } from '../cancellation-refund/policy-refund.execution.js';
import { executionSnapshot } from '../cancellation-refund/cancellation-refund.interface.js';
import { notificationService } from "../notification/notification.service.js";
import { auditLogService } from "../auditLog/auditLog.service.js";
import { logUnexpectedError } from "../../utils/normalize-error.js";
import Stripe from "stripe";

import {
  AppointmentStatus,
  BalanceType,
  BookingMethod,
  PaymentProvider,
  PaymentPurpose,
  PaymentStatus,
  Prisma,
  RefundRequestStatus,
  RefundStatus,
  WalletTransactionType,
} from "../../../../generated/prisma/client.js";

import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../utils/app-error.js";

// Use the SAME initialized Stripe client used by refundPayment().
import { stripe } from "../../lib/stripe.js";

const createHongKongDateTime = (date: Date, time: string) => {
  const datePart = date.toISOString().slice(0, 10);
  return new Date(`${datePart}T${time}:00+08:00`);
};

const toCents = (amount: Prisma.Decimal | number) =>
  Math.round(Number(amount) * 100);

const processApprovedRefund = async (requestId: string, reviewerId: string) => {
  // =====================================================
  // 0. ROUTE REFUND TO THE CORRECT PAYMENT PROVIDER
  // =====================================================

  const request = await prisma.refundRequest.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      status: true,
      refundId: true,
      payment: {
        select: {
          provider: true,
        },
      },
    },
  });

  if (!request) {
    throw new AppError("REFUND_REQUEST_NOT_FOUND", 404);
  }

  if (request.status === RefundRequestStatus.PROCESSING && request.payment.provider === PaymentProvider.STRIPE) {
    return reconcileApprovedStripeRefund(requestId);
  }

  if (request.status !== RefundRequestStatus.APPROVED) {
    throw new AppError("REFUND_REQUEST_NOT_APPROVED", 409);
  }

  if (request.refundId !== null) {
    throw new AppError("REFUND_ALREADY_PROCESSING", 409);
  }

  // WALLET: process entirely inside PostgreSQL transaction.
  if (request.payment.provider === PaymentProvider.WALLET) {
    return processApprovedWalletRefund(requestId, reviewerId);
  }

  // STRIPE: continue existing Stripe processing unchanged.
  if (request.payment.provider !== PaymentProvider.STRIPE) {
    throw new AppError("REFUND_PROVIDER_NOT_SUPPORTED", 409);
  }

  // 1. CLAIM REQUEST + CREATE STABLE LOCAL REFUND
  // =====================================================

  const claimed = await prisma.$transaction(
    async (tx) => {
      const request = await tx.refundRequest.findUnique({
        where: { id: requestId },

        include: {
          payment: {
            include: {
              refunds: true,

              appointment: {
                include: {
                  branch: {
                    include: {
                      bookingPolicy: true,
                    },
                  },
                },
              },

              groupPurchase: {
                include: {
                  appointments: true,
                },
              },
            },
          },
        },
      });

      if (!request) {
        throw new AppError("REFUND_REQUEST_NOT_FOUND", 404);
      }

      if (request.status !== RefundRequestStatus.APPROVED) {
        throw new AppError("REFUND_REQUEST_NOT_APPROVED", 409);
      }

      const payment = request.payment;
      if (payment.groupPurchaseId) await tx.$queryRaw`SELECT "id" FROM "GroupPurchase" WHERE "id"=${payment.groupPurchaseId} FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "Payment" WHERE "id"=${payment.id} FOR UPDATE`;
      const policyExecution = await validatePolicyRefund(tx, request);

      if (
        payment.provider !== PaymentProvider.STRIPE ||
        !payment.providerPaymentId
      ) {
        throw new AppError("STRIPE_PAYMENT_REQUIRED", 409);
      }

      if (
        payment.status !== PaymentStatus.PAID &&
        payment.status !== PaymentStatus.PARTIALLY_REFUNDED
      ) {
        throw new AppError("PAYMENT_NOT_REFUNDABLE", 409);
      }

      const refundablePurposes: PaymentPurpose[] = [
        PaymentPurpose.APPOINTMENT,
        PaymentPurpose.APPOINTMENT_DEPOSIT,
        PaymentPurpose.GROUP_PURCHASE,
      ];

      if (!refundablePurposes.includes(payment.purpose)) {
        throw new AppError("REFUND_PURPOSE_NOT_SUPPORTED", 409);
      }

      const alreadyRefunded = payment.refunds
        .filter((refund) => refund.status === RefundStatus.SUCCEEDED)
        .reduce((sum, refund) => sum + toCents(refund.amount), 0);

      const remainingCents = toCents(payment.amount) - alreadyRefunded;

      const requestedCents = toCents(request.amount);

      if (requestedCents <= 0 || requestedCents > remainingCents) {
        throw new AppError("REFUND_AMOUNT_INVALID", 409);
      }

      if (
        payment.refunds.some((refund) => refund.status === RefundStatus.PENDING)
      ) {
        throw new AppError("ANOTHER_REFUND_IS_PENDING", 409);
      }

      // =================================================
      // 2. APPOINTMENT POLICY
      // =================================================

      if (
        !policyExecution && (payment.purpose === PaymentPurpose.APPOINTMENT ||
        payment.purpose === PaymentPurpose.APPOINTMENT_DEPOSIT)
      ) {
        const appointment = payment.appointment;

        if (!appointment) {
          throw new AppError("APPOINTMENT_NOT_FOUND", 404);
        }

        const refundableAppointmentStatuses: AppointmentStatus[] = [
          AppointmentStatus.RESERVED,
          AppointmentStatus.CONFIRMED,
        ];

        if (
          !refundableAppointmentStatuses.includes(appointment.appointmentStatus)
        ) {
          throw new AppError("APPOINTMENT_NOT_ELIGIBLE_FOR_REFUND", 409);
        }

        const policy = appointment.branch.bookingPolicy;

        if (!policy) {
          throw new AppError("BOOKING_POLICY_NOT_FOUND", 404);
        }

        const appointmentAt = createHongKongDateTime(
          appointment.date,
          appointment.startTime,
        );

        const cutoffAt = new Date(
          appointmentAt.getTime() -
            policy.cancellationCutoffHours * 60 * 60 * 1000,
        );

        // Original request time, NOT processing time.
        if (request.createdAt >= cutoffAt) {
          throw new AppError("REFUND_REQUEST_AFTER_CUTOFF", 409);
        }
      }

      // =================================================
      // 3. GROUP PURCHASE POLICY
      // =================================================

      if (payment.purpose === PaymentPurpose.GROUP_PURCHASE && !policyExecution) {
        const purchase = payment.groupPurchase;

        if (!purchase) {
          throw new AppError("GROUP_PURCHASE_NOT_FOUND", 404);
        }

        if (purchase.paymentStatus !== PaymentStatus.PAID) {
          throw new AppError("GROUP_PURCHASE_NOT_REFUNDABLE", 409);
        }

        const activeBookings = purchase.appointments.some(
          (appointment) =>
            appointment.appointmentStatus !== AppointmentStatus.CANCELLED,
        );

        if (activeBookings) {
          throw new AppError("GROUP_PURCHASE_HAS_USED_OR_ACTIVE_VOUCHERS", 409);
        }

        // V1: full unused purchase refund only.
        if (requestedCents !== toCents(payment.amount)) {
          throw new AppError("GROUP_PURCHASE_FULL_REFUND_REQUIRED", 409);
        }
      }

      // =================================================
      // 4. ATOMIC STATUS CLAIM
      // =================================================

      const updated = await tx.refundRequest.updateMany({
        where: {
          id: requestId,
          status: RefundRequestStatus.APPROVED,
          refundId: null,
        },
        data: {
          status: RefundRequestStatus.PROCESSING,
        },
      });

      if (updated.count !== 1) {
        throw new AppError("REFUND_ALREADY_PROCESSING", 409);
      }

      const localRefund = await tx.refund.create({
        data: {
          paymentId: payment.id,
          amount: request.amount,
          reason: request.reason,
          status: RefundStatus.PENDING,
          idempotencyKey: `refund-request-${requestId}`,
          refundAttemptedAt: new Date(),
        },
      });

      await tx.refundRequest.update({
        where: { id: requestId },
        data: {
          refundId: localRefund.id,
        },
      });

      return {
        requestId,
        refundId: localRefund.id,
        paymentId: payment.id,
        providerPaymentId: payment.providerPaymentId,
        amountCents: requestedCents,
        currency: payment.currency,
        reason: request.reason,
      };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 10000,
      timeout: 15000,
    },
  );

  // =====================================================
  // 5. STRIPE REFUND
  // =====================================================

  let stripeRefund: Stripe.Refund;

  try {
    stripeRefund = await stripe.refunds.create(
      {
        payment_intent: claimed.providerPaymentId,
        amount: claimed.amountCents,
        metadata: {
          refundRequestId: claimed.requestId,
          refundId: claimed.refundId,
          paymentId: claimed.paymentId,
        },
      },
      {
        idempotencyKey: `refund-request-${claimed.requestId}`,
        maxNetworkRetries: 0,
      },
    );
  } catch (error) {
    logUnexpectedError(error, { source: "src/app/module/refund-request/refund-request.processing.ts:306" });

    // Keep PROCESSING + PENDING.
    // Stripe might have accepted the request.
    // Reconciliation is required before retrying.
    throw new AppError("STRIPE_REFUND_RECONCILIATION_REQUIRED", 502);
  }

  const refundedIntentId = typeof stripeRefund.payment_intent === "string" ? stripeRefund.payment_intent : stripeRefund.payment_intent?.id;
  if (refundedIntentId !== claimed.providerPaymentId || stripeRefund.amount !== claimed.amountCents || stripeRefund.currency.toLowerCase() !== claimed.currency.toLowerCase()) {
    throw new AppError("STRIPE_REFUND_RECONCILIATION_REQUIRED", 502);
  }

  await prisma.refund.update({
    where: { id: claimed.refundId },
    data: {
      providerRefundId: stripeRefund.id,
    },
  });

  // =====================================================
  // 6. FAILED / PENDING REFUND
  // =====================================================

  if (stripeRefund.status === "failed" || stripeRefund.status === "canceled") {
    await prisma.$transaction([
      prisma.refund.update({
        where: { id: claimed.refundId },
        data: { status: RefundStatus.FAILED },
      }),

      prisma.refundRequest.update({
        where: { id: requestId },
        data: { status: RefundRequestStatus.FAILED },
      }),
    ]);

    throw new AppError("STRIPE_REFUND_FAILED", 502);
  }

  if (stripeRefund.status !== "succeeded") {
    return {
      refundRequestId: requestId,
      refundId: claimed.refundId,
      refundStatus: "PENDING",
      status: "PROCESSING",
    };
  }

  // =====================================================
  // 7. FINALIZE SUCCESS
  // =====================================================

  return finalizeApprovedStripeRefund(requestId, stripeRefund);
};

const finalizeApprovedStripeRefund = async (requestId: string, stripeRefund: Stripe.Refund) => {
  const finalized = await prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "RefundRequest" WHERE "id" = ${requestId} FOR UPDATE`;
      const request = await tx.refundRequest.findUnique({
        where: { id: requestId },

        include: {
          payment: {
            include: {
              refunds: true,
              appointment: {
                include: {
                  payments: true,
                },
              },
              groupPurchase: true,
            },
          },
        },
      });

      if (!request || !request.refundId) {
        throw new AppError("REFUND_REQUEST_NOT_FOUND", 404);
      }

      if (request.status === RefundRequestStatus.COMPLETED) {
        const completed = request.payment.refunds.find(item => item.id === request.refundId);
        if (completed?.providerRefundId !== stripeRefund.id || completed.status !== RefundStatus.SUCCEEDED) throw new AppError("REFUND_RECONCILIATION_MISMATCH", 409);
        return { refundRequestId: requestId, paymentId: request.payment.id, refundId: request.refundId, providerRefundId: stripeRefund.id, amount: Number(request.amount), currency: request.payment.currency, status: "COMPLETED", refundStatus: "SUCCEEDED", paymentStatus: request.payment.status };
      }
      if (request.status !== RefundRequestStatus.PROCESSING) {
        throw new AppError("INVALID_REFUND_PROCESSING_STATE", 409);
      }

      const payment = request.payment;
      const refundedAt = new Date();

      await tx.refund.update({
        where: { id: request.refundId },
        data: {
          status: RefundStatus.SUCCEEDED,
          providerRefundId: stripeRefund.id,
          refundedAt,
        },
      });

      const totalRefundedCents = payment.refunds.reduce(
        (sum, refund) =>
          sum +
          (refund.id === request.refundId ||
          refund.status === RefundStatus.SUCCEEDED
            ? toCents(refund.amount)
            : 0),
        0,
      );

      const fullyRefunded = totalRefundedCents >= toCents(payment.amount);

      const paymentStatus = fullyRefunded
        ? PaymentStatus.REFUNDED
        : PaymentStatus.PARTIALLY_REFUNDED;

      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: paymentStatus,
          ...(fullyRefunded ? { refundedAt } : {}),
        },
      });

      // ===============================================
      // APPOINTMENT CANCELLATION
      // ===============================================

      if (
        payment.purpose === PaymentPurpose.APPOINTMENT ||
        payment.purpose === PaymentPurpose.APPOINTMENT_DEPOSIT
      ) {
        const appointment = payment.appointment;

        if (!appointment) {
          throw new AppError("APPOINTMENT_NOT_FOUND", 404);
        }

        const cancelled = await tx.appointment.updateMany({
          where: {
            id: appointment.id,
            appointmentStatus: {
              in: [AppointmentStatus.RESERVED, AppointmentStatus.CONFIRMED],
            },
          },
          data: {
            appointmentStatus: AppointmentStatus.CANCELLED,
            cancelledAt: refundedAt,
            cancellationReason: request.reason,
            qrToken: null,
          },
        });

        if (cancelled.count !== 1 && !(executionSnapshot(request.policySnapshot) && appointment.appointmentStatus === AppointmentStatus.CANCELLED)) {
          throw new AppError(
            "REFUNDED_APPOINTMENT_REQUIRES_RECONCILIATION",
            409,
          );
        }

        // Recalculate overall appointment payment status.
        const activePaymentStatuses: PaymentStatus[] = [
          PaymentStatus.PAID,
          PaymentStatus.PARTIALLY_PAID,
          PaymentStatus.PARTIALLY_REFUNDED,
        ];

        const otherPaidPayments = appointment.payments.some(
          (item) =>
            item.id !== payment.id &&
            activePaymentStatuses.includes(item.status),
        );

        await tx.appointment.update({
          where: { id: appointment.id },
          data: {
            paymentStatus: otherPaidPayments
              ? PaymentStatus.PARTIALLY_REFUNDED
              : paymentStatus,
          },
        });
      }

      // ===============================================
      // GROUP PURCHASE VOUCHER INVALIDATION
      // ===============================================

      if (payment.purpose === PaymentPurpose.GROUP_PURCHASE) {
        if (!payment.groupPurchase) {
          throw new AppError("GROUP_PURCHASE_NOT_FOUND", 404);
        }

        await tx.groupPurchase.update({
          where: { id: payment.groupPurchase.id },
          data: {
            paymentStatus: PaymentStatus.REFUNDED,
          },
        });
      }

      // ===============================================
      // REFUND REQUEST COMPLETED
      // ===============================================

      await finalizePolicyGroupRefund(tx, request);
      if (payment.purpose !== PaymentPurpose.GROUP_PURCHASE) await recordPolicyRefundCompletion(tx, request, request.refundId, payment.currency);
      await tx.refundRequest.update({
        where: { id: requestId },
        data: {
          status: RefundRequestStatus.COMPLETED,
        },
      });
      if (payment.purpose === PaymentPurpose.GROUP_PURCHASE) {
        await notificationService.createNotification({ userId: request.customerId, type: "REFUND_COMPLETED", title: "Refund completed", message: `Your group purchase refund of ${payment.currency} ${request.amount.toFixed(2)} has been completed.` }, tx);
        await auditLogService.createAuditLog({ userId: null, action: "GROUP_PURCHASE_REFUND_COMPLETED", entityType: "REFUND_REQUEST", entityId: request.id, metadata: { paymentId: payment.id, refundId: request.refundId, providerRefundId: stripeRefund.id } }, tx);
      }


      return {
        refundRequestId: requestId,
        paymentId: payment.id,
        refundId: request.refundId,
        providerRefundId: stripeRefund.id,
        amount: Number(request.amount),
        currency: payment.currency,
        status: "COMPLETED",
        refundStatus: "SUCCEEDED",
        paymentStatus,
      };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 10000,
      timeout: 15000,
    },
  );

  return finalized;
};

export const reconcileApprovedStripeRefund = async (requestId: string) => {
  const request = await prisma.refundRequest.findUnique({ where: { id: requestId }, include: { refund: true, payment: true } });
  if (!request?.refund || request.payment.provider !== PaymentProvider.STRIPE || !request.payment.providerPaymentId || ![RefundRequestStatus.PROCESSING, RefundRequestStatus.COMPLETED].some(status => status === request.status)) throw new AppError("REFUND_NOT_RECONCILABLE", 409);
  let provider: Stripe.Refund | undefined;
  if (request.refund.providerRefundId) provider = await stripe.refunds.retrieve(request.refund.providerRefundId);
  else {
    const matches: Stripe.Refund[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 3; page++) {
      const list = await stripe.refunds.list({ payment_intent: request.payment.providerPaymentId, limit: 100, ...(cursor && { starting_after: cursor }) });
      matches.push(...list.data.filter(item => item.metadata?.refundId === request.refundId && item.metadata?.refundRequestId === requestId));
      if (!list.has_more) break;
      if (page === 2 || !list.data.length) throw new AppError("REFUND_MANUAL_RECONCILIATION_REQUIRED", 503);
      cursor = list.data[list.data.length - 1].id;
    }
    if (matches.length !== 1) throw new AppError("REFUND_MANUAL_RECONCILIATION_REQUIRED", 503);
    provider = matches[0];
  }
  const intentId = typeof provider.payment_intent === "string" ? provider.payment_intent : provider.payment_intent?.id;
  if ((request.refund.providerRefundId && provider.id !== request.refund.providerRefundId) || intentId !== request.payment.providerPaymentId || provider.amount !== toCents(request.amount) || provider.currency.toLowerCase() !== request.payment.currency.toLowerCase()) throw new AppError("REFUND_RECONCILIATION_MISMATCH", 409);
  await prisma.refund.updateMany({ where: { id: request.refund.id, status: RefundStatus.PENDING }, data: { providerRefundId: provider.id } });
  if (provider.status === "succeeded") return finalizeApprovedStripeRefund(requestId, provider);
  if (provider.status === "failed" || provider.status === "canceled") {
    await prisma.$transaction(async tx => {
      const changed = await tx.refundRequest.updateMany({ where: { id: requestId, status: RefundRequestStatus.PROCESSING }, data: { status: RefundRequestStatus.FAILED } });
      if (changed.count) await tx.refund.updateMany({ where: { id: request.refundId!, status: RefundStatus.PENDING }, data: { status: RefundStatus.FAILED } });
    });
    throw new AppError("STRIPE_REFUND_FAILED", 502);
  }
  return { refundRequestId: requestId, refundId: request.refundId, refundStatus: "PENDING", status: "PROCESSING" };
};

const processApprovedWalletRefund = async (
  requestId: string,
  reviewerId: string,
) => {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          // 1. Lock refund request first.
          const lockedRequests = await tx.$queryRaw<Array<{ id: string }>>`
            SELECT "id"
            FROM "RefundRequest"
            WHERE "id" = ${requestId}
            FOR UPDATE
          `;

          if (lockedRequests.length !== 1) {
            throw new AppError("REFUND_REQUEST_NOT_FOUND", 404);
          }

          const request = await tx.refundRequest.findUnique({
            where: { id: requestId },
            include: {
              payment: {
                include: {
                  appointment: {
                    include: {
                      branch: {
                        include: {
                          bookingPolicy: true,
                        },
                      },
                      payments: true,
                    },
                  },
                  groupPurchase: {
                    include: {
                      appointments: true,
                    },
                  },
                },
              },
            },
          });

          if (!request) {
            throw new AppError("REFUND_REQUEST_NOT_FOUND", 404);
          }

          if (
            request.status !== RefundRequestStatus.APPROVED ||
            request.refundId !== null
          ) {
            throw new AppError("REFUND_REQUEST_NOT_APPROVED", 409);
          }

          if (!request.reviewedBy || !request.reviewedAt) {
            throw new AppError("REFUND_APPROVAL_REQUIRED", 409);
          }

          const paymentId = request.paymentId;
          if (request.payment.groupPurchaseId) await tx.$queryRaw`SELECT "id" FROM "GroupPurchase" WHERE "id"=${request.payment.groupPurchaseId} FOR UPDATE`;

          // 2. Lock payment to serialize all refunds.
          const lockedPayments = await tx.$queryRaw<Array<{ id: string }>>`
            SELECT "id"
            FROM "Payment"
            WHERE "id" = ${paymentId}
            FOR UPDATE
          `;

          if (lockedPayments.length !== 1) {
            throw new AppError("PAYMENT_NOT_FOUND", 404);
          }

          const payment = await tx.payment.findUniqueOrThrow({
            where: { id: paymentId },
          });

          if (payment.provider !== PaymentProvider.WALLET) {
            throw new AppError("WALLET_PAYMENT_REQUIRED", 409);
          }

          if (
            payment.status !== PaymentStatus.PAID &&
            payment.status !== PaymentStatus.PARTIALLY_REFUNDED
          ) {
            throw new AppError("PAYMENT_NOT_REFUNDABLE", 409);
          }

          if (
            payment.purpose !== PaymentPurpose.APPOINTMENT &&
            !(executionSnapshot(request.policySnapshot) && payment.purpose === PaymentPurpose.APPOINTMENT_DEPOSIT) &&
            payment.purpose !== PaymentPurpose.GROUP_PURCHASE
          ) {
            throw new AppError("REFUND_PURPOSE_NOT_SUPPORTED", 409);
          }

          const policyExecution = await validatePolicyRefund(tx, request);

          // 3. Validate refund amount.
          const refundAmount = request.amount;
          const paymentAmount = payment.amount;

          if (
            !refundAmount.isFinite() ||
            refundAmount.lte(0) ||
            !refundAmount.mul(100).isInteger()
          ) {
            throw new AppError("REFUND_AMOUNT_INVALID", 409);
          }

          const previousRefunds = await tx.refund.findMany({
            where: { paymentId },
            select: {
              id: true,
              amount: true,
              status: true,
            },
          });

          if (
            previousRefunds.some((item) => item.status === RefundStatus.PENDING)
          ) {
            throw new AppError("REFUND_ALREADY_PENDING", 409);
          }

          const alreadyRefunded = previousRefunds
            .filter((item) => item.status === RefundStatus.SUCCEEDED)
            .reduce(
              (sum, item) => sum.plus(item.amount),
              new Prisma.Decimal(0),
            );

          const totalRefunded = alreadyRefunded.plus(refundAmount);

          if (totalRefunded.gt(paymentAmount)) {
            throw new AppError("REFUND_AMOUNT_INVALID", 409);
          }

          // 4. Validate appointment/group purchase policies.
          if (payment.purpose === PaymentPurpose.APPOINTMENT && !policyExecution) {
            const appointment = request.payment.appointment;

            if (!appointment) {
              throw new AppError("APPOINTMENT_NOT_FOUND", 404);
            }

            if (
              appointment.appointmentStatus !== AppointmentStatus.RESERVED &&
              appointment.appointmentStatus !== AppointmentStatus.CONFIRMED
            ) {
              throw new AppError("APPOINTMENT_NOT_ELIGIBLE_FOR_REFUND", 409);
            }

            const policy = appointment.branch.bookingPolicy;

            if (!policy) {
              throw new AppError("BOOKING_POLICY_NOT_FOUND", 404);
            }

            const appointmentAt = createHongKongDateTime(
              appointment.date,
              appointment.startTime,
            );

            const cutoffHours = policy.cancellationCutoffHours;

            if (
              !Number.isFinite(cutoffHours) ||
              cutoffHours < 0 ||
              Number.isNaN(appointmentAt.getTime())
            ) {
              throw new AppError("INVALID_CANCELLATION_POLICY", 409);
            }

            const cutoffAt = new Date(
              appointmentAt.getTime() - cutoffHours * 60 * 60 * 1000,
            );

            if (request.createdAt >= cutoffAt) {
              throw new AppError("REFUND_REQUEST_AFTER_CUTOFF", 409);
            }

            // Current booking flow cancels the appointment
            // when its approved refund succeeds.
            if (!totalRefunded.equals(paymentAmount)) {
              throw new AppError("APPOINTMENT_FULL_REFUND_REQUIRED", 409);
            }
          }

          if (payment.purpose === PaymentPurpose.GROUP_PURCHASE && !policyExecution) {
            const purchase = request.payment.groupPurchase;

            if (!purchase) {
              throw new AppError("GROUP_PURCHASE_NOT_FOUND", 404);
            }

            if (purchase.paymentStatus !== PaymentStatus.PAID) {
              throw new AppError("GROUP_PURCHASE_NOT_REFUNDABLE", 409);
            }

            if (
              purchase.appointments.some(
                (appointment) =>
                  appointment.appointmentStatus !== AppointmentStatus.CANCELLED,
              )
            ) {
              throw new AppError(
                "GROUP_PURCHASE_HAS_USED_OR_ACTIVE_VOUCHERS",
                409,
              );
            }

            if (
              !refundAmount.equals(paymentAmount) ||
              !alreadyRefunded.equals(0)
            ) {
              throw new AppError("GROUP_PURCHASE_FULL_REFUND_REQUIRED", 409);
            }
          }

          // 5. Find wallet and original deductions.
          const wallet = await tx.wallet.findUnique({
            where: { customerId: payment.customerId },
          });

          if (!wallet) {
            throw new AppError("WALLET_NOT_FOUND", 404);
          }

          if (wallet.currency !== payment.currency) {
            throw new AppError("WALLET_CURRENCY_MISMATCH", 409);
          }

          const referenceId =
            (payment.purpose === PaymentPurpose.APPOINTMENT || payment.purpose === PaymentPurpose.APPOINTMENT_DEPOSIT)
              ? payment.appointmentId
              : payment.groupPurchaseId;

          if (!referenceId) {
            throw new AppError("WALLET_PAYMENT_REFERENCE_MISSING", 409);
          }

          const transactionType =
            (payment.purpose === PaymentPurpose.APPOINTMENT || payment.purpose === PaymentPurpose.APPOINTMENT_DEPOSIT)
              ? WalletTransactionType.APPOINTMENT_PAYMENT
              : WalletTransactionType.GROUP_PURCHASE_PAYMENT;

          const deductions = await tx.walletTransaction.findMany({
            where: {
              walletId: wallet.id,
              referenceId,
              type: transactionType,
              amount: { lt: 0 },
            },
          });

          const paidSpent = deductions
            .filter((item) => item.balanceType === BalanceType.PAID)
            .reduce(
              (sum, item) => sum.plus(item.amount.negated()),
              new Prisma.Decimal(0),
            );

          const bonusSpent = deductions
            .filter((item) => item.balanceType === BalanceType.BONUS)
            .reduce(
              (sum, item) => sum.plus(item.amount.negated()),
              new Prisma.Decimal(0),
            );

          if (!paidSpent.plus(bonusSpent).equals(paymentAmount)) {
            throw new AppError("WALLET_PAYMENT_LEDGER_MISMATCH", 409);
          }

          // 6. Calculate proportional paid/bonus restoration.
          const totalCents = paymentAmount.mul(100).toNumber();
          const paidCents = paidSpent.mul(100).toNumber();
          const beforeCents = alreadyRefunded.mul(100).toNumber();
          const afterCents = totalRefunded.mul(100).toNumber();
          const refundCents = refundAmount.mul(100).toNumber();

          if (
            ![
              totalCents,
              paidCents,
              beforeCents,
              afterCents,
              refundCents,
            ].every(Number.isSafeInteger) ||
            totalCents <= 0
          ) {
            throw new AppError("WALLET_REFUND_ALLOCATION_INVALID", 409);
          }

          const cumulativePaid = (refundedCents: number): number => {
            if (refundedCents === totalCents) {
              return paidCents;
            }

            return new Prisma.Decimal(refundedCents)
              .mul(paidCents)
              .div(totalCents)
              .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)
              .toNumber();
          };

          const paidRefundCents =
            cumulativePaid(afterCents) - cumulativePaid(beforeCents);

          const bonusRefundCents = refundCents - paidRefundCents;

          if (
            paidRefundCents < 0 ||
            bonusRefundCents < 0 ||
            !Number.isSafeInteger(paidRefundCents) ||
            !Number.isSafeInteger(bonusRefundCents)
          ) {
            throw new AppError("WALLET_REFUND_ALLOCATION_INVALID", 409);
          }

          const paidRefund = new Prisma.Decimal(paidRefundCents).div(100);

          const bonusRefund = new Prisma.Decimal(bonusRefundCents).div(100);

          // 7. Create refund record.
          const refundedAt = new Date();

          const refund = await tx.refund.create({
            data: {
              paymentId,
              amount: refundAmount,
              reason: request.reason,
              status: RefundStatus.SUCCEEDED,
              refundedAt,
            },
          });

          // 8. Restore wallet balances.
          await tx.wallet.update({
            where: { id: wallet.id },
            data: {
              paidBalance: { increment: paidRefund },
              bonusBalance: { increment: bonusRefund },
            },
          });

          // 9. Write refund ledger entries.
          if (paidRefund.gt(0)) {
            await tx.walletTransaction.create({
              data: {
                walletId: wallet.id,
                type: WalletTransactionType.REFUND,
                balanceType: BalanceType.PAID,
                amount: paidRefund,
                referenceId: refund.id,
              },
            });
          }

          if (bonusRefund.gt(0)) {
            await tx.walletTransaction.create({
              data: {
                walletId: wallet.id,
                type: WalletTransactionType.REFUND,
                balanceType: BalanceType.BONUS,
                amount: bonusRefund,
                referenceId: refund.id,
              },
            });
          }

          // 10. Update payment status.
          const fullyRefunded = totalRefunded.equals(paymentAmount);

          const paymentStatus = fullyRefunded
            ? PaymentStatus.REFUNDED
            : PaymentStatus.PARTIALLY_REFUNDED;

          await tx.payment.update({
            where: { id: paymentId },
            data: {
              status: paymentStatus,
              ...(fullyRefunded ? { refundedAt } : {}),
            },
          });

          // 11. Cancel refunded appointment.
          if (payment.purpose === PaymentPurpose.APPOINTMENT || payment.purpose === PaymentPurpose.APPOINTMENT_DEPOSIT) {
            const appointment = request.payment.appointment!;

            const cancelled = await tx.appointment.updateMany({
              where: {
                id: appointment.id,
                appointmentStatus: {
                  in: [AppointmentStatus.RESERVED, AppointmentStatus.CONFIRMED],
                },
              },
              data: {
                appointmentStatus: AppointmentStatus.CANCELLED,
                cancelledAt: refundedAt,
                cancellationReason: request.reason,
                qrToken: null,
              },
            });

            if (cancelled.count !== 1 && !(executionSnapshot(request.policySnapshot) && appointment.appointmentStatus === AppointmentStatus.CANCELLED)) {
              throw new AppError(
                "REFUNDED_APPOINTMENT_REQUIRES_RECONCILIATION",
                409,
              );
            }

            const activePaymentStatuses: PaymentStatus[] = [
              PaymentStatus.PAID,
              PaymentStatus.PARTIALLY_PAID,
              PaymentStatus.PARTIALLY_REFUNDED,
            ];

            const otherPaidPayments = appointment.payments.some(
              (item) =>
                item.id !== paymentId &&
                activePaymentStatuses.includes(item.status),
            );

            await tx.appointment.update({
              where: { id: appointment.id },
              data: {
                paymentStatus: otherPaidPayments
                  ? PaymentStatus.PARTIALLY_REFUNDED
                  : paymentStatus,
              },
            });
          }

          // 12. Invalidate refunded group purchase.
          if (payment.purpose === PaymentPurpose.GROUP_PURCHASE) {
            await tx.groupPurchase.update({
              where: { id: payment.groupPurchaseId! },
              data: {
                paymentStatus: PaymentStatus.REFUNDED,
              },
            });
          }

          await finalizePolicyGroupRefund(tx, request);
          await recordPolicyRefundCompletion(tx, request, refund.id, payment.currency);
          // 13. Complete the approved refund request.
          const completed = await tx.refundRequest.updateMany({
            where: {
              id: requestId,
              status: RefundRequestStatus.APPROVED,
              refundId: null,
            },
            data: {
              status: RefundRequestStatus.COMPLETED,
              refundId: refund.id,
            },
          });

          if (completed.count !== 1) {
            throw new AppError("REFUND_REQUEST_ALREADY_PROCESSED", 409);
          }

          return {
            refundRequestId: requestId,
            paymentId,
            refundId: refund.id,
            providerRefundId: null,
            amount: refundAmount.toNumber(),
            currency: payment.currency,
            status: "COMPLETED" as const,
            refundStatus: "SUCCEEDED" as const,
            paymentStatus,
            paidBalanceRefunded: paidRefund.toNumber(),
            bonusBalanceRefunded: bonusRefund.toNumber(),
            processedBy: reviewerId,
          };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 10000,
          timeout: 15000,
        },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034" &&
        attempt < 3
      ) {
        continue;
      }

      throw error;
    }
  }

  throw new AppError("WALLET_REFUND_RETRY_FAILED", 409);
};

export const RefundRequestProcessingService = {
  processApprovedRefund,
  processApprovedWalletRefund,
};
