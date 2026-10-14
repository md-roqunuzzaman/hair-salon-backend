import {
  AppointmentStatus,
  BalanceType,
  BookingMethod,
  PaymentProvider,
  PaymentPurpose,
  PaymentStatus,
  Prisma,
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
  ICreateGroupPurchaseStripeIntentPayload,
  ICreateGroupPurchaseStripeIntentResponse,
  ICreateStripeIntentPayload,
  ICreateStripeIntentResponse,
  IMyPaymentItem,
  IMyPaymentsQuery,
  IPaymentDetailsResponse,
  IRefundPaymentPayload,
  IRefundPaymentResponse,
} from "./payment.interface.js";
import { auditLogService } from "../auditLog/auditLog.service.js";
import { notificationTemplates } from "../notification/notification.templates.js";
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
  // 2. GROUP PURCHASE STRIPE WEBHOOK DISPATCH
  // =====================================================

  if (
    event.type === "payment_intent.succeeded" ||
    event.type === "payment_intent.payment_failed"
  ) {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;

    const payment = await prisma.payment.findUnique({
      where: {
        providerPaymentId: paymentIntent.id,
      },
      select: {
        purpose: true,
      },
    });

    if (payment?.purpose === PaymentPurpose.GROUP_PURCHASE) {
      return handleGroupPurchaseStripeEvent(event, paymentIntent);
    }
  }

  // =====================================================
  // 3. IDEMPOTENCY CHECK
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
  // 4. PAYMENT SUCCESS
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

    if (
      paymentIntent.status !== "succeeded" ||
      paymentIntent.currency.toLowerCase() !== payment.currency.toLowerCase() ||
      paymentIntent.amount_received !== Math.round(Number(payment.amount) * 100)
    ) {
      throw new AppError("Stripe payment verification failed", 409);
    }

    // ===================================================
    // LATE APPOINTMENT PAYMENT TYPE
    // ===================================================

    type LateAppointmentPayment = {
      paymentId: string;
      appointmentId: string;
      customerId: string;
      amount: number;
      currency: string;
      providerPaymentId: string;
    };

    // ===================================================
    // LOCAL SUCCESS TRANSACTION
    // ===================================================

    const transactionResult = await prisma.$transaction(async (tx) => {
      const existingEvent = await tx.stripeWebhookEvent.findUnique({
        where: {
          id: event.id,
        },
      });

      if (existingEvent) {
        return {
          alreadyProcessed: true,
          lateAppointmentPayment: null as LateAppointmentPayment | null,
        };
      }

      const currentPayment = await tx.payment.findUnique({
        where: {
          id: payment.id,
        },
      });

      if (!currentPayment) {
        throw new AppError("Payment not found", 404);
      }

      // =================================================
      // PAYMENT -> PAID
      // =================================================

      if (
        currentPayment.status === PaymentStatus.PENDING ||
        currentPayment.status === PaymentStatus.FAILED
      ) {
        await tx.payment.update({
          where: {
            id: currentPayment.id,
          },
          data: {
            status: PaymentStatus.PAID,
            paidAt: new Date(),
            failedAt: null,
          },
        });
      }

      let lateAppointmentPayment: LateAppointmentPayment | null = null;

      // =================================================
      // APPOINTMENT PAYMENT
      // =================================================

      if (currentPayment.appointmentId) {
        const appointment = await tx.appointment.findUnique({
          where: {
            id: currentPayment.appointmentId,
          },
          select: {
            id: true,
            customerId: true,
            bookingMethod: true,
            appointmentStatus: true,
            paymentStatus: true,
            holdExpiresAt: true,
            qrToken: true,
          },
        });

        if (!appointment) {
          throw new AppError("Appointment not found", 404);
        }

        const now = new Date();

        // ===============================================
        // PAY NOW PAYMENT
        // ===============================================

        if (currentPayment.purpose === PaymentPurpose.APPOINTMENT) {
          if (appointment.bookingMethod !== BookingMethod.PAY_NOW) {
            throw new AppError("Invalid appointment payment purpose", 409);
          }

          const holdIsStillActive =
            appointment.appointmentStatus ===
              AppointmentStatus.PENDING_PAYMENT &&
            appointment.paymentStatus === PaymentStatus.PENDING &&
            Boolean(appointment.holdExpiresAt) &&
            appointment.holdExpiresAt! > now;

          // NORMAL PAY NOW SUCCESS

          if (holdIsStillActive) {
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

            // MULTILINGUAL BOOKING CONFIRMED NOTIFICATION

            const translations = notificationTemplates.PAY_NOW_CONFIRMED();

            await notificationService.createNotification(
              {
                userId: appointment.customerId,
                type: "BOOKING_CONFIRMED",
                title: translations.en!.title!,
                message: translations.en!.message!,
                translations,
              },
              tx,
            );
          }

          // IDEMPOTENT NORMAL SUCCESS
          else if (
            appointment.appointmentStatus === AppointmentStatus.CONFIRMED &&
            appointment.paymentStatus === PaymentStatus.PAID
          ) {
            // Already correctly processed.
          }

          // LATE PAY NOW PAYMENT
          else {
            const lateAppointmentStatus =
              appointment.appointmentStatus ===
              AppointmentStatus.PENDING_PAYMENT
                ? AppointmentStatus.EXPIRED
                : appointment.appointmentStatus;

            await tx.appointment.update({
              where: {
                id: appointment.id,
              },
              data: {
                appointmentStatus: lateAppointmentStatus,
                ...(appointment.paymentStatus !== PaymentStatus.REFUNDED
                  ? {
                      paymentStatus: PaymentStatus.PAID,
                    }
                  : {}),
                holdExpiresAt: null,
              },
            });

            lateAppointmentPayment = {
              paymentId: currentPayment.id,
              appointmentId: appointment.id,
              customerId: appointment.customerId,
              amount: Number(currentPayment.amount),
              currency: currentPayment.currency,
              providerPaymentId: paymentIntent.id,
            };
          }
        }

        // ===============================================
        // DEPOSIT PAYMENT
        // ===============================================

        if (currentPayment.purpose === PaymentPurpose.APPOINTMENT_DEPOSIT) {
          if (appointment.bookingMethod !== BookingMethod.DEPOSIT) {
            throw new AppError("Invalid deposit payment purpose", 409);
          }

          const holdIsStillActive =
            appointment.appointmentStatus ===
              AppointmentStatus.PENDING_PAYMENT &&
            appointment.paymentStatus === PaymentStatus.PENDING &&
            Boolean(appointment.holdExpiresAt) &&
            appointment.holdExpiresAt! > now;

          // NORMAL DEPOSIT SUCCESS

          if (holdIsStillActive) {
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

            // MULTILINGUAL DEPOSIT RECEIVED NOTIFICATION

            const translations = notificationTemplates.DEPOSIT_RECEIVED(
              Number(currentPayment.amount),
              currentPayment.currency,
            );

            await notificationService.createNotification(
              {
                userId: appointment.customerId,
                type: "DEPOSIT_RECEIVED",
                title: translations.en!.title!,
                message: translations.en!.message!,
                translations,
              },
              tx,
            );
          }

          // IDEMPOTENT NORMAL DEPOSIT SUCCESS
          else if (
            (appointment.appointmentStatus === AppointmentStatus.RESERVED ||
              appointment.appointmentStatus === AppointmentStatus.CONFIRMED) &&
            appointment.paymentStatus === PaymentStatus.PARTIALLY_PAID
          ) {
            // Already correctly processed.
          }

          // LATE DEPOSIT PAYMENT
          else {
            const lateAppointmentStatus =
              appointment.appointmentStatus ===
              AppointmentStatus.PENDING_PAYMENT
                ? AppointmentStatus.EXPIRED
                : appointment.appointmentStatus;

            await tx.appointment.update({
              where: {
                id: appointment.id,
              },
              data: {
                appointmentStatus: lateAppointmentStatus,
                ...(appointment.paymentStatus !== PaymentStatus.REFUNDED
                  ? {
                      paymentStatus: PaymentStatus.PAID,
                    }
                  : {}),
                holdExpiresAt: null,
              },
            });

            lateAppointmentPayment = {
              paymentId: currentPayment.id,
              appointmentId: appointment.id,
              customerId: appointment.customerId,
              amount: Number(currentPayment.amount),
              currency: currentPayment.currency,
              providerPaymentId: paymentIntent.id,
            };
          }
        }
      }

      // =================================================
      // WALLET TOP-UP PAYMENT
      // =================================================

      if (currentPayment.walletTopupId) {
        const topup = await tx.walletTopup.findUnique({
          where: {
            id: currentPayment.walletTopupId,
          },
        });

        if (!topup) {
          throw new AppError("Wallet top-up not found", 404);
        }

        if (topup.status !== WalletTopupStatus.PAID) {
          // CREDIT PAID BALANCE + BONUS

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

          // TOP-UP LEDGER

          await tx.walletTransaction.create({
            data: {
              walletId: topup.walletId,
              type: WalletTransactionType.TOP_UP,
              balanceType: BalanceType.PAID,
              amount: topup.amount,
              referenceId: topup.id,
            },
          });

          // BONUS LEDGER

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

          // TOP-UP -> PAID

          await tx.walletTopup.update({
            where: {
              id: topup.id,
            },
            data: {
              status: WalletTopupStatus.PAID,
              paidAt: new Date(),
            },
          });

          // MULTILINGUAL WALLET TOP-UP NOTIFICATION

          const translations = notificationTemplates.WALLET_TOPUP_SUCCESS(
            Number(topup.amount),
            currentPayment.currency,
          );

          await notificationService.createNotification(
            {
              userId: currentPayment.customerId,
              type: "WALLET_TOPUP_SUCCESS",
              title: translations.en!.title!,
              message: translations.en!.message!,
              translations,
            },
            tx,
          );
        }
      }

      // =================================================
      // MARK WEBHOOK PROCESSED
      // =================================================

      if (!lateAppointmentPayment) {
        await tx.stripeWebhookEvent.create({
          data: {
            id: event.id,
            type: event.type,
          },
        });
      }

      return {
        alreadyProcessed: false,
        lateAppointmentPayment,
      };
    });

    // ===================================================
    // TRANSACTION ALREADY PROCESSED
    // ===================================================

    if (transactionResult.alreadyProcessed) {
      return {
        received: true as const,
      };
    }

    const latePayment = transactionResult.lateAppointmentPayment;

    // ===================================================
    // LATE APPOINTMENT PAYMENT AUTO-REFUND
    // ===================================================

    if (latePayment) {
      let localRefund = await prisma.refund.findFirst({
        where: {
          paymentId: latePayment.paymentId,
          reason: "LATE_PAYMENT_AFTER_APPOINTMENT_EXPIRY",
        },
        orderBy: {
          createdAt: "desc",
        },
      });

      // Refund already succeeded: normalize local state.

      if (localRefund?.status === RefundStatus.SUCCEEDED) {
        await prisma.$transaction(async (tx) => {
          await tx.payment.update({
            where: {
              id: latePayment.paymentId,
            },
            data: {
              status: PaymentStatus.REFUNDED,
              refundedAt: localRefund!.refundedAt ?? new Date(),
            },
          });

          await tx.appointment.update({
            where: {
              id: latePayment.appointmentId,
            },
            data: {
              paymentStatus: PaymentStatus.REFUNDED,
              holdExpiresAt: null,
            },
          });

          await tx.stripeWebhookEvent.upsert({
            where: {
              id: event.id,
            },
            update: {},
            create: {
              id: event.id,
              type: event.type,
            },
          });
        });

        return {
          received: true as const,
        };
      }

      // CREATE OR REOPEN LOCAL REFUND ATTEMPT

      if (!localRefund) {
        localRefund = await prisma.refund.create({
          data: {
            paymentId: latePayment.paymentId,
            amount: latePayment.amount,
            reason: "LATE_PAYMENT_AFTER_APPOINTMENT_EXPIRY",
            status: RefundStatus.PENDING,
          },
        });
      } else if (localRefund.status === RefundStatus.FAILED) {
        localRefund = await prisma.refund.update({
          where: {
            id: localRefund.id,
          },
          data: {
            status: RefundStatus.PENDING,
          },
        });
      }

      try {
        // ===============================================
        // STRIPE AUTO REFUND
        // ===============================================

        const stripeRefund = await stripe.refunds.create(
          {
            payment_intent: latePayment.providerPaymentId,
            amount: Math.round(latePayment.amount * 100),
            metadata: {
              paymentId: latePayment.paymentId,
              appointmentId: latePayment.appointmentId,
              refundId: localRefund.id,
              reason: "LATE_PAYMENT_AFTER_APPOINTMENT_EXPIRY",
            },
          },
          {
            idempotencyKey: `late-payment-refund-${latePayment.paymentId}`,
          },
        );

        // Only finalize after Stripe confirms success.

        if (stripeRefund.status !== "succeeded") {
          await prisma.refund.update({
            where: {
              id: localRefund.id,
            },
            data: {
              providerRefundId: stripeRefund.id,
              status: RefundStatus.PENDING,
            },
          });

          throw new AppError("Late payment refund is not completed yet", 503);
        }

        // ===============================================
        // FINALIZE REFUND LOCALLY
        // ===============================================

        await prisma.$transaction(async (tx) => {
          const refundedAt = new Date();

          await tx.refund.update({
            where: {
              id: localRefund.id,
            },
            data: {
              providerRefundId: stripeRefund.id,
              status: RefundStatus.SUCCEEDED,
              refundedAt,
            },
          });

          await tx.payment.update({
            where: {
              id: latePayment.paymentId,
            },
            data: {
              status: PaymentStatus.REFUNDED,
              refundedAt,
            },
          });

          // Do not restore or confirm expired appointment.

          await tx.appointment.update({
            where: {
              id: latePayment.appointmentId,
            },
            data: {
              paymentStatus: PaymentStatus.REFUNDED,
              holdExpiresAt: null,
            },
          });

          // MULTILINGUAL LATE PAYMENT REFUND NOTIFICATION

          const translations = notificationTemplates.LATE_APPOINTMENT_REFUND(
            latePayment.amount,
            latePayment.currency,
          );

          await notificationService.createNotification(
            {
              userId: latePayment.customerId,
              type: "REFUND_COMPLETED",
              title: translations.en!.title!,
              message: translations.en!.message!,
              translations,
            },
            tx,
          );

          // Mark event after refund completion.

          await tx.stripeWebhookEvent.upsert({
            where: {
              id: event.id,
            },
            update: {},
            create: {
              id: event.id,
              type: event.type,
            },
          });
        });
      } catch (error) {
        // A pending Stripe refund must not be marked FAILED.

        if (
          error instanceof AppError &&
          error.message === "Late payment refund is not completed yet"
        ) {
          throw error;
        }

        await prisma.refund.update({
          where: {
            id: localRefund.id,
          },
          data: {
            status: RefundStatus.FAILED,
          },
        });

        console.error("[Late Payment Refund] Automatic refund failed", error);

        throw new AppError("Late payment automatic refund failed", 502);
      }
    }

    return {
      received: true as const,
    };
  }

  // =====================================================
  // 5. PAYMENT FAILED
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

        // Re-read current payment to avoid notifying after success.

        const currentPayment = await tx.payment.findUnique({
          where: {
            id: payment.id,
          },
        });

        if (!currentPayment) {
          throw new AppError("Payment not found", 404);
        }

        // PAYMENT -> FAILED
        // Only pending payment attempts can become FAILED.

        if (currentPayment.status === PaymentStatus.PENDING) {
          const changed = await tx.payment.updateMany({
            where: {
              id: currentPayment.id,
              status: PaymentStatus.PENDING,
            },
            data: {
              status: PaymentStatus.FAILED,
              failedAt: new Date(),
            },
          });

          // MULTILINGUAL PAYMENT FAILED NOTIFICATION

          if (changed.count === 1 && currentPayment.appointmentId) {
            const translations = notificationTemplates.PAYMENT_FAILED();

            await notificationService.createNotification(
              {
                userId: currentPayment.customerId,
                type: "PAYMENT_FAILED",
                title: translations.en!.title!,
                message: translations.en!.message!,
                translations,
              },
              tx,
            );
          }
        }

        // WALLET TOP-UP -> FAILED

        if (currentPayment.walletTopupId) {
          const topup = await tx.walletTopup.findUnique({
            where: {
              id: currentPayment.walletTopupId,
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

        // MARK EVENT PROCESSED

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
  // 6. UNHANDLED EVENT
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

const createGroupPurchaseStripeIntent = async (
  customerId: string,
  payload: ICreateGroupPurchaseStripeIntentPayload,
): Promise<ICreateGroupPurchaseStripeIntentResponse> => {
  const { purchaseId } = payload;

  // =====================================================
  // 1. FIND GROUP PURCHASE
  // =====================================================

  const purchase = await prisma.groupPurchase.findUnique({
    where: {
      id: purchaseId,
    },
    select: {
      id: true,
      customerId: true,
      amount: true,
      paymentStatus: true,
      reservationExpiresAt: true,
    },
  });

  if (!purchase) {
    throw new AppError("Group purchase not found", 404);
  }

  // =====================================================
  // 2. CUSTOMER OWNERSHIP
  // =====================================================

  if (purchase.customerId !== customerId) {
    throw new AppError(
      "You are not allowed to pay for this group purchase",
      403,
    );
  }

  // =====================================================
  // 3. PAYMENT STATUS VALIDATION
  // =====================================================

  if (purchase.paymentStatus === PaymentStatus.PAID) {
    throw new AppError("Group purchase is already paid", 409);
  }

  if (purchase.paymentStatus !== PaymentStatus.PENDING) {
    throw new AppError("Group purchase is not awaiting payment", 409);
  }

  // =====================================================
  // 4. RESERVATION EXPIRY VALIDATION
  // =====================================================

  const now = new Date();

  if (!purchase.reservationExpiresAt || purchase.reservationExpiresAt <= now) {
    throw new AppError("Group purchase payment reservation has expired", 409);
  }

  // =====================================================
  // 5. VALIDATE PAYMENT AMOUNT
  // =====================================================

  const amount = Number(purchase.amount);
  const amountInCents = Math.round(amount * 100);

  if (!Number.isSafeInteger(amountInCents) || amountInCents < 400) {
    throw new AppError("Invalid Stripe payment amount", 422);
  }

  // =====================================================
  // 6. FIND EXISTING STRIPE PAYMENT ATTEMPT
  // =====================================================

  let payment = await prisma.payment.findFirst({
    where: {
      groupPurchaseId: purchaseId,
      customerId,
      purpose: PaymentPurpose.GROUP_PURCHASE,
      provider: PaymentProvider.STRIPE,
      status: PaymentStatus.PENDING,
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  // =====================================================
  // 7. CREATE LOCAL PAYMENT IF NOT EXISTS
  // =====================================================

  if (!payment) {
    payment = await prisma.payment.create({
      data: {
        customerId,
        groupPurchaseId: purchaseId,
        purpose: PaymentPurpose.GROUP_PURCHASE,
        provider: PaymentProvider.STRIPE,
        amount: purchase.amount,
        currency: "HKD",
        status: PaymentStatus.PENDING,
      },
    });
  }

  // =====================================================
  // 8. REUSE OR CREATE STRIPE PAYMENT INTENT
  // =====================================================

  try {
    let paymentIntent: Stripe.PaymentIntent;

    if (payment.providerPaymentId) {
      paymentIntent = await stripe.paymentIntents.retrieve(
        payment.providerPaymentId,
      );
    } else {
      paymentIntent = await stripe.paymentIntents.create(
        {
          amount: amountInCents,
          currency: "hkd",

          metadata: {
            paymentId: payment.id,
            groupPurchaseId: purchaseId,
            customerId,
            purpose: PaymentPurpose.GROUP_PURCHASE,
          },

          automatic_payment_methods: {
            enabled: true,
            allow_redirects: "never",
          },
        },
        {
          idempotencyKey: `group-purchase-intent-${payment.id}`,
        },
      );

      await prisma.payment.update({
        where: {
          id: payment.id,
        },
        data: {
          providerPaymentId: paymentIntent.id,
        },
      });
    }

    // ===================================================
    // 9. VERIFY STRIPE INTENT IS STILL PAYABLE
    // ===================================================

    const payableStatuses = [
      "requires_payment_method",
      "requires_confirmation",
      "requires_action",
    ];

    if (
      !paymentIntent.client_secret ||
      !payableStatuses.includes(paymentIntent.status)
    ) {
      throw new AppError("Stripe PaymentIntent is not in a payable state", 409);
    }

    // Recheck reservation after Stripe network operations.
    const currentPurchase = await prisma.groupPurchase.findUnique({
      where: {
        id: purchaseId,
      },
      select: {
        paymentStatus: true,
        reservationExpiresAt: true,
      },
    });

    if (
      !currentPurchase ||
      currentPurchase.paymentStatus !== PaymentStatus.PENDING ||
      !currentPurchase.reservationExpiresAt ||
      currentPurchase.reservationExpiresAt <= new Date()
    ) {
      throw new AppError(
        "Group purchase reservation is no longer payable",
        409,
      );
    }

    // ===================================================
    // 10. RESPONSE
    // ===================================================

    return {
      paymentId: payment.id,
      purchaseId,
      amount: Number(payment.amount),
      currency: payment.currency,
      paymentStatus: "PENDING",
      clientSecret: paymentIntent.client_secret,
    };
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    console.error("[Group Purchase Stripe Intent] Error:", error);

    throw new AppError(
      "Unable to create Group Purchase Stripe PaymentIntent",
      502,
    );
  }
};

const handleGroupPurchaseStripeEvent = async (
  event: Stripe.Event,
  paymentIntent: Stripe.PaymentIntent,
) => {
  // =====================================================
  // 1. FIND GROUP PURCHASE PAYMENT
  // =====================================================

  const payment = await prisma.payment.findUnique({
    where: {
      providerPaymentId: paymentIntent.id,
    },
  });

  if (
    !payment ||
    payment.purpose !== PaymentPurpose.GROUP_PURCHASE ||
    !payment.groupPurchaseId
  ) {
    throw new AppError("Group purchase payment not found", 404);
  }

  // =====================================================
  // 2. VERIFY STRIPE PAYMENT DATA
  // =====================================================

  if (
    payment.provider !== PaymentProvider.STRIPE ||
    paymentIntent.currency.toLowerCase() !== payment.currency.toLowerCase() ||
    paymentIntent.amount !== Math.round(Number(payment.amount) * 100) ||
    paymentIntent.metadata?.paymentId !== payment.id ||
    paymentIntent.metadata?.groupPurchaseId !== payment.groupPurchaseId ||
    paymentIntent.metadata?.customerId !== payment.customerId ||
    paymentIntent.metadata?.purpose !== PaymentPurpose.GROUP_PURCHASE
  ) {
    throw new AppError("Stripe payment verification failed", 409);
  }

  // =====================================================
  // 3. IDEMPOTENCY CHECK
  // =====================================================

  const alreadyProcessed = await prisma.stripeWebhookEvent.findUnique({
    where: {
      id: event.id,
    },
  });

  if (alreadyProcessed) {
    return {
      received: true as const,
    };
  }

  // =====================================================
  // 4. PAYMENT FAILED
  //
  // Failed payment attempt does not automatically expire
  // the group purchase reservation.
  // =====================================================

  if (event.type === "payment_intent.payment_failed") {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.stripeWebhookEvent.findUnique({
        where: {
          id: event.id,
        },
      });

      if (existing) {
        return;
      }

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
  // 5. HANDLE ONLY PAYMENT SUCCESS
  // =====================================================

  if (event.type !== "payment_intent.succeeded") {
    return {
      received: true as const,
    };
  }

  if (
    paymentIntent.status !== "succeeded" ||
    paymentIntent.amount_received !== Math.round(Number(payment.amount) * 100)
  ) {
    throw new AppError("Stripe payment was not successful", 409);
  }

  // =====================================================
  // 6. SUCCESS SETTLEMENT OR LATE PAYMENT DETECTION
  // =====================================================

  type SettlementResult = "SETTLED" | "ALREADY_PAID" | "REFUND_REQUIRED";

  let settlementResult: SettlementResult | null = null;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      settlementResult = await prisma.$transaction(
        async (tx): Promise<SettlementResult> => {
          // ===============================================
          // RECHECK WEBHOOK IDEMPOTENCY
          // ===============================================

          const existing = await tx.stripeWebhookEvent.findUnique({
            where: {
              id: event.id,
            },
          });

          if (existing) {
            return "ALREADY_PAID";
          }

          // ===============================================
          // FETCH CURRENT PAYMENT AND PURCHASE
          // ===============================================

          const currentPayment = await tx.payment.findUnique({
            where: {
              id: payment.id,
            },
          });

          const purchase = await tx.groupPurchase.findUnique({
            where: {
              id: payment.groupPurchaseId!,
            },
          });

          if (!currentPayment || !purchase) {
            throw new AppError("Payment or purchase not found", 404);
          }

          // ===============================================
          // VERIFY PURCHASE OWNERSHIP AND AMOUNT
          // ===============================================

          if (
            purchase.customerId !== currentPayment.customerId ||
            purchase.amount.comparedTo(currentPayment.amount) !== 0
          ) {
            throw new AppError("Group purchase payment mismatch", 409);
          }

          // ===============================================
          // ALREADY PAID
          // ===============================================

          if (purchase.paymentStatus === PaymentStatus.PAID) {
            if (
              currentPayment.status !== PaymentStatus.PAID ||
              !purchase.purchasedAt
            ) {
              throw new AppError(
                "Group purchase settlement state is inconsistent",
                409,
              );
            }

            await tx.stripeWebhookEvent.create({
              data: {
                id: event.id,
                type: event.type,
              },
            });

            return "ALREADY_PAID";
          }

          const now = new Date();

          const activeReservation =
            purchase.paymentStatus === PaymentStatus.PENDING &&
            purchase.reservationExpiresAt !== null &&
            purchase.reservationExpiresAt > now;

          // ===============================================
          // 7. LATE PAYMENT
          // DO NOT ACTIVATE EXPIRED PURCHASE
          // ===============================================

          if (!activeReservation) {
            if (
              currentPayment.status !== PaymentStatus.REFUNDED &&
              currentPayment.status !== PaymentStatus.PAID
            ) {
              await tx.payment.update({
                where: {
                  id: currentPayment.id,
                },
                data: {
                  status: PaymentStatus.PAID,
                  paidAt: now,
                  failedAt: null,
                },
              });
            }

            // Release reserved inventory only when
            // purchase is still PENDING.

            if (purchase.paymentStatus === PaymentStatus.PENDING) {
              const changed = await tx.groupPurchase.updateMany({
                where: {
                  id: purchase.id,
                  paymentStatus: PaymentStatus.PENDING,
                },
                data: {
                  paymentStatus: PaymentStatus.FAILED,
                },
              });

              if (changed.count === 1) {
                const released = await tx.package.updateMany({
                  where: {
                    id: purchase.packageId,
                    reservedQuantity: {
                      gte: purchase.quantity,
                    },
                  },
                  data: {
                    reservedQuantity: {
                      decrement: purchase.quantity,
                    },
                  },
                });

                if (released.count !== 1) {
                  throw new AppError(
                    "Unable to release expired inventory",
                    409,
                  );
                }
              }
            }

            // Webhook event will be marked processed
            // after successful refund finalization.

            return "REFUND_REQUIRED";
          }

          // ===============================================
          // 8. VALID GROUP PURCHASE SETTLEMENT
          // ===============================================

          const updatedPurchase = await tx.groupPurchase.updateMany({
            where: {
              id: purchase.id,
              paymentStatus: PaymentStatus.PENDING,
              reservationExpiresAt: {
                gt: now,
              },
            },
            data: {
              paymentStatus: PaymentStatus.PAID,
              purchasedAt: now,
              reservationExpiresAt: null,
            },
          });

          if (updatedPurchase.count !== 1) {
            throw new AppError("Purchase settlement conflict", 409);
          }

          // ===============================================
          // 9. UPDATE PACKAGE INVENTORY
          // ===============================================

          const updatedPackage = await tx.package.updateMany({
            where: {
              id: purchase.packageId,
              reservedQuantity: {
                gte: purchase.quantity,
              },
            },
            data: {
              reservedQuantity: {
                decrement: purchase.quantity,
              },
              soldQuantity: {
                increment: purchase.quantity,
              },
            },
          });

          if (updatedPackage.count !== 1) {
            throw new AppError("Inventory settlement failed", 409);
          }

          // ===============================================
          // 10. MARK PAYMENT AS PAID
          // ===============================================

          await tx.payment.update({
            where: {
              id: currentPayment.id,
            },
            data: {
              status: PaymentStatus.PAID,
              paidAt: now,
              failedAt: null,
            },
          });

          // ===============================================
          // 11. MULTILINGUAL GROUP PURCHASE NOTIFICATION
          // ===============================================

          const translations = notificationTemplates.GROUP_PURCHASE_SUCCESSFUL(
            Number(currentPayment.amount),
            currentPayment.currency,
          );

          await notificationService.createNotification(
            {
              userId: purchase.customerId,
              type: "GROUP_PURCHASE_SUCCESSFUL",
              title: translations.en!.title!,
              message: translations.en!.message!,
              translations,
            },
            tx,
          );

          // ===============================================
          // 12. MARK WEBHOOK EVENT PROCESSED
          // ===============================================

          await tx.stripeWebhookEvent.create({
            data: {
              id: event.id,
              type: event.type,
            },
          });

          return "SETTLED";
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 10000,
          timeout: 15000,
        },
      );

      break;
    } catch (error) {
      const retryable =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034";

      if (retryable && attempt < 3) {
        continue;
      }

      throw error;
    }
  }

  // =====================================================
  // 13. NORMAL SETTLEMENT COMPLETE
  // =====================================================

  if (settlementResult !== "REFUND_REQUIRED") {
    return {
      received: true as const,
    };
  }

  // =====================================================
  // 14. LATE PAYMENT AUTOMATIC REFUND
  // =====================================================

  const refundReason = "LATE_GROUP_PURCHASE_PAYMENT";

  let localRefund = await prisma.refund.findFirst({
    where: {
      paymentId: payment.id,
      reason: refundReason,
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  // ===============================================
  // CREATE LOCAL REFUND RECORD
  // ===============================================

  if (!localRefund) {
    localRefund = await prisma.refund.create({
      data: {
        paymentId: payment.id,
        amount: payment.amount,
        reason: refundReason,
        status: RefundStatus.PENDING,
      },
    });
  }

  // =====================================================
  // 15. PROCESS STRIPE REFUND
  // =====================================================

  try {
    let providerRefundId = localRefund.providerRefundId;

    if (localRefund.status !== RefundStatus.SUCCEEDED) {
      const stripeRefund = await stripe.refunds.create(
        {
          payment_intent: paymentIntent.id,
          amount: Math.round(Number(payment.amount) * 100),
          metadata: {
            paymentId: payment.id,
            groupPurchaseId: payment.groupPurchaseId!,
            reason: refundReason,
          },
        },
        {
          idempotencyKey: `late-group-purchase-refund-${payment.id}`,
        },
      );

      providerRefundId = stripeRefund.id;

      // ===============================================
      // STRIPE REFUND PENDING
      // ===============================================

      if (stripeRefund.status !== "succeeded") {
        await prisma.refund.update({
          where: {
            id: localRefund.id,
          },
          data: {
            providerRefundId,
            status: RefundStatus.PENDING,
          },
        });

        throw new AppError("Stripe refund is not completed yet", 503);
      }
    }

    // ===================================================
    // 16. FINALIZE REFUND LOCALLY
    // ===================================================

    await prisma.$transaction(async (tx) => {
      const existingEvent = await tx.stripeWebhookEvent.findUnique({
        where: {
          id: event.id,
        },
      });

      if (existingEvent) {
        return;
      }

      const refundedAt = new Date();

      await tx.refund.update({
        where: {
          id: localRefund.id,
        },
        data: {
          providerRefundId,
          status: RefundStatus.SUCCEEDED,
          refundedAt: localRefund.refundedAt ?? refundedAt,
        },
      });

      // ===============================================
      // PAYMENT -> REFUNDED
      // ===============================================

      await tx.payment.update({
        where: {
          id: payment.id,
        },
        data: {
          status: PaymentStatus.REFUNDED,
          refundedAt,
        },
      });

      // ===============================================
      // 17. MULTILINGUAL LATE GROUP REFUND NOTIFICATION
      // ===============================================

      const translations = notificationTemplates.LATE_GROUP_REFUND(
        Number(payment.amount),
        payment.currency,
      );

      await notificationService.createNotification(
        {
          userId: payment.customerId,
          type: "REFUND_COMPLETED",
          title: translations.en!.title!,
          message: translations.en!.message!,
          translations,
        },
        tx,
      );

      // ===============================================
      // 18. MARK WEBHOOK EVENT PROCESSED
      // ===============================================

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
  } catch (error) {
    console.error("[Group Purchase Late Refund] Processing failed:", error);

    // Keep webhook unprocessed so Stripe can retry.
    // Do not mark payment REFUNDED before confirmation.

    throw new AppError(
      "Group purchase late payment refund requires retry",
      503,
    );
  }
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

  if (
    payment.provider !== PaymentProvider.STRIPE ||
    !payment.providerPaymentId
  ) {
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

  const refundAmount = payload.amount;
  const refundReason = payload.reason.trim();

  if (
    !Number.isFinite(refundAmount) ||
    refundAmount <= 0 ||
    !Number.isInteger(refundAmount * 100) ||
    refundAmount > remainingRefundable
  ) {
    throw new AppError("REFUND_AMOUNT_INVALID", 400);
  }

  if (!refundReason) {
    throw new AppError("REFUND_REASON_REQUIRED", 400);
  }

  // =====================================================
  // 5. CHECK UNRESOLVED REFUND REQUESTS
  //
  // Do not start another refund while a previous Stripe
  // refund is still pending or needs reconciliation.
  // =====================================================

  const unresolvedRefund = await prisma.refund.findFirst({
    where: {
      paymentId,
      status: RefundStatus.PENDING,
    },
    select: {
      id: true,
    },
  });

  if (unresolvedRefund) {
    throw new AppError("REFUND_ALREADY_PENDING", 409);
  }

  // =====================================================
  // 6. CREATE LOCAL PENDING REFUND
  // =====================================================

  const localRefund = await prisma.refund.create({
    data: {
      paymentId,
      amount: refundAmount,
      reason: refundReason,
      status: RefundStatus.PENDING,
    },
  });

  // =====================================================
  // 7. CREATE STRIPE REFUND
  // =====================================================

  let stripeRefund: Stripe.Refund;

  try {
    stripeRefund = await stripe.refunds.create(
      {
        payment_intent: payment.providerPaymentId,
        amount: Math.round(refundAmount * 100),
        metadata: {
          paymentId,
          refundId: localRefund.id,
          reason: refundReason,
        },
      },
      {
        idempotencyKey: `refund-${localRefund.id}`,
      },
    );
  } catch (error) {
    console.error("[Refund Payment] Stripe refund request failed:", error);

    // The request may have reached Stripe even if the
    // response failed. Keep PENDING for reconciliation.
    // Do not mark FAILED without verifying Stripe state.

    throw new AppError("STRIPE_OPERATION_FAILED", 502);
  }

  // =====================================================
  // 8. STORE STRIPE REFUND ID
  // =====================================================

  await prisma.refund.update({
    where: {
      id: localRefund.id,
    },
    data: {
      providerRefundId: stripeRefund.id,
    },
  });

  // =====================================================
  // 9. HANDLE NON-SUCCEEDED STRIPE REFUND
  // =====================================================

  if (stripeRefund.status === "failed" || stripeRefund.status === "canceled") {
    await prisma.refund.update({
      where: {
        id: localRefund.id,
      },
      data: {
        status: RefundStatus.FAILED,
      },
    });

    throw new AppError("STRIPE_REFUND_FAILED", 502);
  }

  if (stripeRefund.status !== "succeeded") {
    // Stripe has accepted the refund but has not
    // confirmed its completion.
    //
    // Keep local refund PENDING.
    // Do not change payment status.
    // Do not send REFUND_COMPLETED notification.
    // A separate reconciliation process must finalize it.

    throw new AppError("STRIPE_REFUND_PENDING", 409);
  }

  // =====================================================
  // 10. DETERMINE PARTIAL / FULL REFUND
  // =====================================================

  const totalRefunded = alreadyRefunded + refundAmount;

  const fullyRefunded =
    Math.round(totalRefunded * 100) >= Math.round(paymentAmount * 100);

  const newPaymentStatus = fullyRefunded
    ? PaymentStatus.REFUNDED
    : PaymentStatus.PARTIALLY_REFUNDED;

  // =====================================================
  // 11. FINALIZE LOCALLY + NOTIFICATION + AUDIT LOG
  // =====================================================

  await prisma.$transaction(async (tx) => {
    const refundedAt = new Date();

    // ===============================================
    // REFUND -> SUCCEEDED
    // ===============================================

    await tx.refund.update({
      where: {
        id: localRefund.id,
      },
      data: {
        providerRefundId: stripeRefund.id,
        status: RefundStatus.SUCCEEDED,
        refundedAt,
      },
    });

    // ===============================================
    // PAYMENT -> REFUNDED / PARTIALLY_REFUNDED
    // ===============================================

    await tx.payment.update({
      where: {
        id: paymentId,
      },
      data: {
        status: newPaymentStatus,
        refundedAt: fullyRefunded ? refundedAt : payment.refundedAt,
      },
    });

    // ===============================================
    // MULTILINGUAL CUSTOMER NOTIFICATION
    // ===============================================

    const translations = notificationTemplates.REFUND_COMPLETED(
      refundAmount,
      payment.currency,
    );

    await notificationService.createNotification(
      {
        userId: payment.customerId,
        type: "REFUND_COMPLETED",
        title: translations.en!.title!,
        message: translations.en!.message!,
        translations,
      },
      tx,
    );

    // ===============================================
    // AUDIT LOG
    // ===============================================

    await auditLogService.createAuditLog(
      {
        userId,
        action: "REFUND_PROCESSED",
        entityType: "PAYMENT",
        entityId: paymentId,
        metadata: {
          refundId: localRefund.id,
          providerRefundId: stripeRefund.id,
          amount: refundAmount,
          currency: payment.currency,
          reason: refundReason,
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
  // 12. RESPONSE
  // =====================================================

  return {
    paymentId,
    refundId: localRefund.id,
    refundStatus: "SUCCEEDED",
    amount: refundAmount,
  };
};

export const paymentService = {
  createStripeIntent,
  handleStripeWebhook,
  getPaymentById,
  getMyPayments,
  refundPayment,
  createGroupPurchaseStripeIntent,
  handleGroupPurchaseStripeEvent,
};
