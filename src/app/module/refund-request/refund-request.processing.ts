import Stripe from "stripe";

import {
  AppointmentStatus,
  BookingMethod,
  PaymentProvider,
  PaymentPurpose,
  PaymentStatus,
  Prisma,
  RefundRequestStatus,
  RefundStatus,
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
        payment.purpose === PaymentPurpose.APPOINTMENT ||
        payment.purpose === PaymentPurpose.APPOINTMENT_DEPOSIT
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

      if (payment.purpose === PaymentPurpose.GROUP_PURCHASE) {
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
      },
    );
  } catch (error) {
    console.error("[Refund Request] Stripe error:", error);

    // Keep PROCESSING + PENDING.
    // Stripe might have accepted the request.
    // Reconciliation is required before retrying.
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

  const finalized = await prisma.$transaction(
    async (tx) => {
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

        if (cancelled.count !== 1) {
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

      await tx.refundRequest.update({
        where: { id: requestId },
        data: {
          status: RefundRequestStatus.COMPLETED,
        },
      });

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

export const RefundRequestProcessingService = {
  processApprovedRefund,
};
