import {
  AppointmentStatus,
  BalanceType,
  BookingMethod,
  PaymentProvider,
  PaymentPurpose,
  PaymentStatus,
  RefundStatus,
  Role,
  WalletTopupStatus,
  WalletTransactionType,
} from "../../../../generated/prisma/client.js";

import { prisma } from "../../lib/prisma.js";
import { stripe } from "../../lib/stripe.js";
import crypto from "crypto";
import { AppError } from "../../utils/app-error.js";
import Stripe from "stripe";

import config from "../../config/index.js";
import { notificationService } from "../notification/notification.service.js";

import {
  ICreateStripeIntentPayload,
  ICreateStripeIntentResponse,
  IMyPaymentItem,
  IMyPaymentsQuery,
  IPaymentDetailsResponse,
  IRefundPaymentPayload,
  IRefundPaymentResponse,
} from "./payment.interface.js";
import { auditLogService } from "../auditLog/auditLog.service.js";
const createStripeIntent = async (
  customerId: string,
  payload: ICreateStripeIntentPayload,
): Promise<ICreateStripeIntentResponse> => {
  // =====================================================
  // 1. FIND APPOINTMENT
  // =====================================================

  const appointment = await prisma.appointment.findUnique({
    where: {
      id: payload.appointmentId,
    },

    select: {
      id: true,
      customerId: true,

      bookingMethod: true,
      appointmentStatus: true,
      paymentStatus: true,

      price: true,

      depositAmount: true,
      remainingAmount: true,

      currency: true,

      holdExpiresAt: true,
    },
  });

  if (!appointment) {
    throw new AppError("Appointment not found", 404);
  }

  // =====================================================
  // 2. CUSTOMER OWNERSHIP
  // =====================================================

  if (appointment.customerId !== customerId) {
    throw new AppError("You are not allowed to pay for this appointment", 403);
  }

  // =====================================================
  // 3. MUST BE PAY NOW OR DEPOSIT
  // =====================================================

  if (
    appointment.bookingMethod !== BookingMethod.PAY_NOW &&
    appointment.bookingMethod !== BookingMethod.DEPOSIT
  ) {
    throw new AppError(
      "PaymentIntent can only be created for Pay Now or Deposit appointments",
      409,
    );
  }

  // =====================================================
  // 4. VALID APPOINTMENT STATE
  // =====================================================

  if (appointment.appointmentStatus !== AppointmentStatus.PENDING_PAYMENT) {
    throw new AppError("Appointment is not awaiting payment", 409);
  }

  if (appointment.paymentStatus === PaymentStatus.PAID) {
    throw new AppError("Appointment has already been paid", 409);
  }

  if (appointment.paymentStatus !== PaymentStatus.PENDING) {
    throw new AppError("Appointment payment is not in a payable state", 409);
  }

  // =====================================================
  // 5. ACTIVE HOLD CHECK
  // =====================================================

  if (!appointment.holdExpiresAt || appointment.holdExpiresAt <= new Date()) {
    throw new AppError("Appointment payment hold has expired", 409);
  }

  // =====================================================
  // 6. DETERMINE PAYMENT PURPOSE + AMOUNT
  // =====================================================

  let paymentPurpose: PaymentPurpose;
  let paymentAmount;

  if (appointment.bookingMethod === BookingMethod.PAY_NOW) {
    paymentPurpose = PaymentPurpose.APPOINTMENT;

    paymentAmount = appointment.price;
  } else {
    if (!appointment.depositAmount) {
      throw new AppError(
        "Deposit amount is not configured for this appointment",
        500,
      );
    }

    paymentPurpose = PaymentPurpose.APPOINTMENT_DEPOSIT;

    paymentAmount = appointment.depositAmount;
  }

  // =====================================================
  // 7. REUSE EXISTING ACTIVE PENDING PAYMENT
  // =====================================================
  // Mobile/frontend may call create-intent more than once.
  // Do not blindly create multiple Stripe PaymentIntents.
  // =====================================================

  const existingPayment = await prisma.payment.findFirst({
    where: {
      appointmentId: appointment.id,

      customerId,

      purpose: paymentPurpose,

      status: PaymentStatus.PENDING,

      providerPaymentId: {
        not: null,
      },
    },

    orderBy: {
      createdAt: "desc",
    },
  });

  if (existingPayment && existingPayment.providerPaymentId) {
    try {
      const existingIntent = await stripe.paymentIntents.retrieve(
        existingPayment.providerPaymentId,
      );

      if (
        existingIntent.client_secret &&
        [
          "requires_payment_method",
          "requires_confirmation",
          "requires_action",
          "processing",
        ].includes(existingIntent.status)
      ) {
        return {
          paymentId: existingPayment.id,

          appointmentId: appointment.id,

          amount: Number(existingPayment.amount),

          currency: existingPayment.currency,

          paymentStatus: "PENDING",

          clientSecret: existingIntent.client_secret,
        };
      }
    } catch {
      // Existing provider intent cannot be reused.
      // Continue and create a fresh payment attempt.
    }
  }

  // =====================================================
  // 8. CREATE LOCAL PAYMENT ATTEMPT
  // =====================================================

  const payment = await prisma.payment.create({
    data: {
      customerId,

      appointmentId: appointment.id,

      purpose: paymentPurpose,

      amount: paymentAmount,

      currency: appointment.currency,

      status: PaymentStatus.PENDING,
    },
  });

  // =====================================================
  // 9. CREATE STRIPE PAYMENT INTENT
  // =====================================================

  try {
    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount: Math.round(Number(paymentAmount) * 100),

        currency: appointment.currency.toLowerCase(),

        metadata: {
          paymentId: payment.id,

          appointmentId: appointment.id,

          customerId,

          purpose: paymentPurpose,
        },

        automatic_payment_methods: {
          enabled: true,

          allow_redirects: "never",
        },
      },

      {
        idempotencyKey: `${paymentPurpose.toLowerCase()}-${payment.id}`,
      },
    );

    if (!paymentIntent.client_secret) {
      throw new Error("Stripe did not return client secret");
    }

    // ===================================================
    // 10. SAVE STRIPE PAYMENT INTENT ID
    // ===================================================

    const updatedPayment = await prisma.payment.update({
      where: {
        id: payment.id,
      },

      data: {
        providerPaymentId: paymentIntent.id,
      },
    });

    return {
      paymentId: updatedPayment.id,

      appointmentId: appointment.id,

      amount: Number(updatedPayment.amount),

      currency: updatedPayment.currency,

      paymentStatus: "PENDING",

      clientSecret: paymentIntent.client_secret,
    };
  } catch {
    // ===================================================
    // Stripe operation failed:
    // keep audit trail but mark this attempt failed.
    // Appointment remains PENDING_PAYMENT until hold expiry.
    // ===================================================

    await prisma.payment.update({
      where: {
        id: payment.id,
      },

      data: {
        status: PaymentStatus.FAILED,

        failedAt: new Date(),
      },
    });

    throw new AppError("Stripe PaymentIntent creation failed", 502);
  }
};

const handleStripeWebhook = async (payload: Buffer, signature: string) => {
  // =====================================================
  // 1. VERIFY STRIPE SIGNATURE
  // =====================================================

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      payload,
      signature,
      config.stripe_webhook_secret,
    );
  } catch {
    throw new AppError("Invalid Stripe webhook signature", 400);
  }

  // =====================================================
  // 2. IDEMPOTENCY CHECK
  // =====================================================

  const processedEvent = await prisma.stripeWebhookEvent.findUnique({
    where: {
      id: event.id,
    },
  });

  if (processedEvent) {
    return {
      received: true as const,
    };
  }

  // =====================================================
  // 3. PAYMENT SUCCESS
  // =====================================================

  if (event.type === "payment_intent.succeeded") {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;

    const payment = await prisma.payment.findUnique({
      where: {
        providerPaymentId: paymentIntent.id,
      },
    });

    if (!payment) {
      throw new AppError("Payment not found", 404);
    }

    await prisma.$transaction(async (tx) => {
      // -----------------------------------------------
      // Re-check idempotency inside transaction
      // -----------------------------------------------

      const existingEvent = await tx.stripeWebhookEvent.findUnique({
        where: {
          id: event.id,
        },
      });

      if (existingEvent) {
        return;
      }

      // -----------------------------------------------
      // PAYMENT -> PAID
      // -----------------------------------------------

      if (payment.status !== PaymentStatus.PAID) {
        await tx.payment.update({
          where: {
            id: payment.id,
          },

          data: {
            status: PaymentStatus.PAID,

            paidAt: new Date(),
          },
        });
      }

      // =================================================
      // APPOINTMENT PAYMENT
      // =================================================

      // =================================================
      // APPOINTMENT PAYMENT
      // =================================================

      if (payment.appointmentId) {
        const appointment = await tx.appointment.findUnique({
          where: {
            id: payment.appointmentId,
          },

          select: {
            id: true,
            customerId: true,
            bookingMethod: true,
            appointmentStatus: true,
            paymentStatus: true,
            qrToken: true,
          },
        });

        if (!appointment) {
          throw new AppError("Appointment not found", 404);
        }

        // =================================================
        // PAY NOW PAYMENT
        // =================================================

        if (payment.purpose === PaymentPurpose.APPOINTMENT) {
          if (appointment.bookingMethod !== BookingMethod.PAY_NOW) {
            throw new AppError("Invalid appointment payment purpose", 409);
          }

          if (
            appointment.appointmentStatus === AppointmentStatus.PENDING_PAYMENT
          ) {
            await tx.appointment.update({
              where: {
                id: appointment.id,
              },

              data: {
                appointmentStatus: AppointmentStatus.CONFIRMED,
                paymentStatus: PaymentStatus.PAID,
                holdExpiresAt: null,
              },
            });

            await notificationService.createNotification(
              {
                userId: appointment.customerId,
                type: "BOOKING_CONFIRMED",
                title: "Booking confirmed",
                message: "Your appointment has been confirmed successfully.",
              },
              tx,
            );
          } else if (appointment.paymentStatus !== PaymentStatus.PAID) {
            await tx.appointment.update({
              where: {
                id: appointment.id,
              },

              data: {
                paymentStatus: PaymentStatus.PAID,
                holdExpiresAt: null,
              },
            });
          }
        }

        // =================================================
        // DEPOSIT PAYMENT
        // =================================================

        if (payment.purpose === PaymentPurpose.APPOINTMENT_DEPOSIT) {
          if (appointment.bookingMethod !== BookingMethod.DEPOSIT) {
            throw new AppError("Invalid deposit payment purpose", 409);
          }

          if (
            appointment.appointmentStatus === AppointmentStatus.PENDING_PAYMENT
          ) {
            const qrToken =
              appointment.qrToken ?? crypto.randomBytes(32).toString("hex");

            await tx.appointment.update({
              where: {
                id: appointment.id,
              },

              data: {
                appointmentStatus: AppointmentStatus.RESERVED,
                paymentStatus: PaymentStatus.PARTIALLY_PAID,
                holdExpiresAt: null,

                qrToken,
                qrVerifiedAt: null,
                qrVerifiedBy: null,
              },
            });

            await notificationService.createNotification(
              {
                userId: appointment.customerId,
                type: "BOOKING_CONFIRMED",
                title: "Deposit received",
                message:
                  "Your deposit has been received and your appointment is reserved.",
              },
              tx,
            );
          }
        }
      }

      // =================================================
      // WALLET TOP-UP PAYMENT
      // =================================================

      if (payment.walletTopupId) {
        const topup = await tx.walletTopup.findUnique({
          where: {
            id: payment.walletTopupId,
          },
        });

        if (!topup) {
          throw new AppError("Wallet top-up not found", 404);
        }

        if (topup.status !== WalletTopupStatus.PAID) {
          // ---------------------------------------------
          // CREDIT WALLET
          // ---------------------------------------------

          await tx.wallet.update({
            where: {
              id: topup.walletId,
            },

            data: {
              paidBalance: {
                increment: topup.amount,
              },

              bonusBalance: {
                increment: topup.potentialBonus,
              },
            },
          });

          // ---------------------------------------------
          // TOP-UP LEDGER
          // ---------------------------------------------

          await tx.walletTransaction.create({
            data: {
              walletId: topup.walletId,

              type: WalletTransactionType.TOP_UP,

              balanceType: BalanceType.PAID,

              amount: topup.amount,

              referenceId: topup.id,
            },
          });

          // ---------------------------------------------
          // BONUS LEDGER
          // ---------------------------------------------

          if (Number(topup.potentialBonus) > 0) {
            await tx.walletTransaction.create({
              data: {
                walletId: topup.walletId,

                type: WalletTransactionType.BONUS,

                balanceType: BalanceType.BONUS,

                amount: topup.potentialBonus,

                referenceId: topup.id,
              },
            });
          }

          // ---------------------------------------------
          // TOP-UP -> PAID
          // ---------------------------------------------

          await tx.walletTopup.update({
            where: {
              id: topup.id,
            },

            data: {
              status: WalletTopupStatus.PAID,

              paidAt: new Date(),
            },
          });

          await notificationService.createNotification(
            {
              userId: payment.customerId,
              type: "WALLET_TOPUP_SUCCESS",
              title: "Wallet top-up successful",
              message: "Your wallet top-up has been completed successfully.",
            },
            tx,
          );
        }
      }

      // =================================================
      // MARK WEBHOOK EVENT PROCESSED
      // MUST BE LAST
      // =================================================

      await tx.stripeWebhookEvent.create({
        data: {
          id: event.id,
          type: event.type,
        },
      });
    });

    return {
      received: true as const,
    };
  }

  // =====================================================
  // 4. PAYMENT FAILED
  // =====================================================

  if (event.type === "payment_intent.payment_failed") {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;

    const payment = await prisma.payment.findUnique({
      where: {
        providerPaymentId: paymentIntent.id,
      },
    });

    if (payment) {
      await prisma.$transaction(async (tx) => {
        const existingEvent = await tx.stripeWebhookEvent.findUnique({
          where: {
            id: event.id,
          },
        });

        if (existingEvent) {
          return;
        }

        // -----------------------------------------------
        // PAYMENT -> FAILED
        // -----------------------------------------------

        if (payment.status !== PaymentStatus.PAID) {
          await tx.payment.update({
            where: {
              id: payment.id,
            },

            data: {
              status: PaymentStatus.FAILED,

              failedAt: new Date(),
            },
          });
        }

        // =================================================
        // WALLET TOP-UP -> FAILED
        // =================================================

        if (payment.walletTopupId) {
          const topup = await tx.walletTopup.findUnique({
            where: {
              id: payment.walletTopupId,
            },
          });

          if (topup && topup.status === WalletTopupStatus.PENDING) {
            await tx.walletTopup.update({
              where: {
                id: topup.id,
              },

              data: {
                status: WalletTopupStatus.FAILED,

                failedAt: new Date(),
              },
            });
          }
        }

        // -----------------------------------------------
        // MARK EVENT PROCESSED
        // -----------------------------------------------

        await tx.stripeWebhookEvent.create({
          data: {
            id: event.id,
            type: event.type,
          },
        });
      });
    } else {
      await prisma.stripeWebhookEvent.create({
        data: {
          id: event.id,
          type: event.type,
        },
      });
    }

    return {
      received: true as const,
    };
  }

  // =====================================================
  // 5. UNHANDLED EVENT
  // =====================================================

  await prisma.stripeWebhookEvent.create({
    data: {
      id: event.id,
      type: event.type,
    },
  });

  return {
    received: true as const,
  };
};

const getPaymentById = async (
  paymentId: string,
  userId: string,
  role: Role,
): Promise<IPaymentDetailsResponse> => {
  const payment = await prisma.payment.findUnique({
    where: {
      id: paymentId,
    },

    include: {
      appointment: {
        select: {
          id: true,
          customerId: true,
          branchId: true,
        },
      },
    },
  });

  if (!payment) {
    throw new AppError("Payment not found", 404);
  }

  // =====================================================
  // CUSTOMER OWNERSHIP
  // =====================================================

  if (role === Role.CUSTOMER) {
    if (payment.customerId !== userId) {
      throw new AppError("You are not allowed to access this payment", 403);
    }
  }

  // =====================================================
  // BRANCH MANAGER SCOPE
  // =====================================================

  if (role === Role.BRANCH_MANAGER) {
    if (!payment.appointment) {
      throw new AppError("You are not allowed to access this payment", 403);
    }

    const managerBranch = await prisma.branchManagerBranch.findUnique({
      where: {
        userId_branchId: {
          userId,
          branchId: payment.appointment.branchId,
        },
      },
    });

    if (!managerBranch) {
      throw new AppError("You are not allowed to access this payment", 403);
    }
  }

  // BRAND_OWNER = brand-wide access.

  return {
    id: payment.id,
    amount: Number(payment.amount),
    currency: payment.currency,
    paymentStatus: payment.status,
    provider: payment.provider,
    providerPaymentId: payment.providerPaymentId,
    appointmentId: payment.appointmentId,
  };
};

const getMyPayments = async (customerId: string, query: IMyPaymentsQuery) => {
  // =====================================================
  // 1. PAGINATION
  // =====================================================

  const page = Number(query.page ?? 1);
  const limit = Number(query.limit ?? 20);

  if (page < 1) {
    throw new AppError("page must be at least 1", 400);
  }

  if (limit < 1 || limit > 100) {
    throw new AppError("limit must be between 1 and 100", 400);
  }

  const skip = (page - 1) * limit;

  // =====================================================
  // 2. FILTER
  // =====================================================

  const where = {
    customerId,

    ...(query.status
      ? {
          status: query.status as PaymentStatus,
        }
      : {}),
  };

  // =====================================================
  // 3. FETCH + COUNT
  // =====================================================

  const [payments, total] = await prisma.$transaction([
    prisma.payment.findMany({
      where,

      skip,
      take: limit,

      orderBy: {
        createdAt: "desc",
      },

      select: {
        id: true,
        amount: true,
        currency: true,
        status: true,
        provider: true,
        providerPaymentId: true,
        appointmentId: true,
      },
    }),

    prisma.payment.count({
      where,
    }),
  ]);

  // =====================================================
  // 4. RESPONSE DTO
  // =====================================================

  const items: IMyPaymentItem[] = payments.map((payment) => ({
    id: payment.id,

    amount: Number(payment.amount),

    currency: payment.currency,

    paymentStatus: payment.status,

    provider: payment.provider,

    providerPaymentId: payment.providerPaymentId,

    appointmentId: payment.appointmentId,
  }));

  const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

  return {
    items,

    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    },
  };
};

const refundPayment = async (
  paymentId: string,
  userId: string,
  payload: IRefundPaymentPayload,
): Promise<IRefundPaymentResponse> => {
  // =====================================================
  // 1. FIND PAYMENT
  // =====================================================

  const payment = await prisma.payment.findUnique({
    where: {
      id: paymentId,
    },
  });

  if (!payment) {
    throw new AppError("PAYMENT_NOT_FOUND", 404);
  }

  // =====================================================
  // 2. REFUND ALLOWED STATE
  // =====================================================

  if (
    payment.status !== PaymentStatus.PAID &&
    payment.status !== PaymentStatus.PARTIALLY_REFUNDED
  ) {
    throw new AppError("REFUND_NOT_ALLOWED", 409);
  }

  if (payment.purpose === PaymentPurpose.APPOINTMENT_DEPOSIT) {
    throw new AppError("DEPOSIT_PAYMENT_REFUND_NOT_SUPPORTED", 409);
  }

  if (payment.provider === PaymentProvider.SALON) {
    throw new AppError("SALON_PAYMENT_REFUND_NOT_SUPPORTED", 409);
  }

  if (!payment.providerPaymentId) {
    throw new AppError("REFUND_NOT_ALLOWED", 409);
  }

  // =====================================================
  // 3. CALCULATE ALREADY REFUNDED
  // =====================================================

  const refundSummary = await prisma.refund.aggregate({
    where: {
      paymentId,
      status: RefundStatus.SUCCEEDED,
    },

    _sum: {
      amount: true,
    },
  });

  const alreadyRefunded = Number(refundSummary._sum.amount ?? 0);

  const paymentAmount = Number(payment.amount);

  const remainingRefundable = paymentAmount - alreadyRefunded;

  // =====================================================
  // 4. VALIDATE REQUESTED AMOUNT
  // =====================================================

  if (payload.amount <= 0 || payload.amount > remainingRefundable) {
    throw new AppError("REFUND_AMOUNT_INVALID", 400);
  }

  // =====================================================
  // 5. CREATE LOCAL PENDING REFUND
  // =====================================================

  const localRefund = await prisma.refund.create({
    data: {
      paymentId,

      amount: payload.amount,

      reason: payload.reason.trim(),

      status: RefundStatus.PENDING,
    },
  });

  // =====================================================
  // 6. CREATE STRIPE REFUND
  // =====================================================

  try {
    const stripeRefund = await stripe.refunds.create(
      {
        payment_intent: payment.providerPaymentId,

        amount: Math.round(payload.amount * 100),

        metadata: {
          paymentId,

          refundId: localRefund.id,

          reason: payload.reason.trim(),
        },
      },

      {
        idempotencyKey: `refund-${localRefund.id}`,
      },
    );

    // ===================================================
    // 7. DETERMINE PARTIAL / FULL
    // ===================================================

    const totalRefunded = alreadyRefunded + payload.amount;

    const fullyRefunded = totalRefunded >= paymentAmount;

    const newPaymentStatus = fullyRefunded
      ? PaymentStatus.REFUNDED
      : PaymentStatus.PARTIALLY_REFUNDED;

    // ===================================================
    // 8. UPDATE LOCALLY + NOTIFICATION + AUDIT LOG
    // ===================================================

    await prisma.$transaction(async (tx) => {
      await tx.refund.update({
        where: {
          id: localRefund.id,
        },

        data: {
          providerRefundId: stripeRefund.id,

          status: RefundStatus.SUCCEEDED,

          refundedAt: new Date(),
        },
      });

      await tx.payment.update({
        where: {
          id: paymentId,
        },

        data: {
          status: newPaymentStatus,

          refundedAt: fullyRefunded ? new Date() : payment.refundedAt,
        },
      });

      // =================================================
      // CUSTOMER NOTIFICATION
      // =================================================

      await notificationService.createNotification(
        {
          userId: payment.customerId,

          type: "REFUND_COMPLETED",

          title: "Refund completed",

          message: "Your refund has been processed successfully.",
        },

        tx,
      );

      // =================================================
      // AUDIT LOG
      // =================================================

      await auditLogService.createAuditLog(
        {
          userId,

          action: "REFUND_PROCESSED",

          entityType: "PAYMENT",

          entityId: paymentId,

          metadata: {
            refundId: localRefund.id,

            providerRefundId: stripeRefund.id,

            amount: payload.amount,

            reason: payload.reason.trim(),

            previousPaymentStatus: payment.status,

            newPaymentStatus,

            alreadyRefunded,

            totalRefunded,

            fullyRefunded,
          },
        },

        tx,
      );
    });

    // =====================================================
    // 9. RESPONSE
    // =====================================================

    return {
      paymentId,

      refundId: localRefund.id,

      refundStatus: "SUCCEEDED",

      amount: payload.amount,
    };
  } catch {
    // =====================================================
    // 10. MARK LOCAL REFUND FAILED
    // =====================================================

    await prisma.refund.update({
      where: {
        id: localRefund.id,
      },

      data: {
        status: RefundStatus.FAILED,
      },
    });

    throw new AppError("STRIPE_OPERATION_FAILED", 502);
  }
};

export const paymentService = {
  createStripeIntent,
  handleStripeWebhook,
  getPaymentById,
  getMyPayments,
  refundPayment,
};
