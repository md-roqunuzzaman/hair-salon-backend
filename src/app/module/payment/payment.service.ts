import { reconcileApprovedStripeRefund } from "../refund-request/refund-request.processing.js";
import { getOrCreateLateGroupPurchaseRefund, ensureLateGroupPurchaseRefund } from "./late-group-refund.js";
import { logUnexpectedError } from "../../utils/normalize-error.js";
import {
  AppointmentStatus,
  BalanceType,
  BookingMethod,
  GroupPurchaseFlow,
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

      groupPurchaseId: true,

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
  // 3. BLOCK GROUP PURCHASE-LINKED APPOINTMENTS
  // =====================================================

  if (appointment.groupPurchaseId !== null) {
    throw new AppError(
      "Group Purchase-linked appointments must use the Group Purchase payment flow",
      409,
    );
  }

  // =====================================================
  // 4. MUST BE PAY NOW OR DEPOSIT
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
  // 5. VALID APPOINTMENT STATE
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
  // 6. ACTIVE HOLD CHECK
  // =====================================================

  if (!appointment.holdExpiresAt || appointment.holdExpiresAt <= new Date()) {
    throw new AppError("Appointment payment hold has expired", 409);
  }

  // =====================================================
  // 7. DETERMINE PAYMENT PURPOSE + AMOUNT
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
  // 8. REUSE EXISTING ACTIVE PENDING PAYMENT
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
    // Recheck appointment before returning an existing
    // Stripe client secret.
    const currentAppointment = await prisma.appointment.findUnique({
      where: {
        id: appointment.id,
      },
      select: {
        customerId: true,
        groupPurchaseId: true,
        appointmentStatus: true,
        paymentStatus: true,
        holdExpiresAt: true,
      },
    });

    if (
      !currentAppointment ||
      currentAppointment.customerId !== customerId ||
      currentAppointment.groupPurchaseId !== null ||
      currentAppointment.appointmentStatus !==
        AppointmentStatus.PENDING_PAYMENT ||
      currentAppointment.paymentStatus !== PaymentStatus.PENDING ||
      !currentAppointment.holdExpiresAt ||
      currentAppointment.holdExpiresAt <= new Date()
    ) {
      throw new AppError("Appointment is no longer eligible for payment", 409);
    }

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
      // Existing Stripe intent cannot be reused.
      // Continue with a new payment attempt.
    }
  }

  // =====================================================
  // 9. RECHECK BEFORE CREATING PAYMENT ATTEMPT
  // =====================================================

  const latestAppointment = await prisma.appointment.findUnique({
    where: {
      id: appointment.id,
    },

    select: {
      customerId: true,
      groupPurchaseId: true,
      bookingMethod: true,
      appointmentStatus: true,
      paymentStatus: true,
      holdExpiresAt: true,
    },
  });

  if (
    !latestAppointment ||
    latestAppointment.customerId !== customerId ||
    latestAppointment.groupPurchaseId !== null ||
    latestAppointment.bookingMethod !== appointment.bookingMethod ||
    latestAppointment.appointmentStatus !== AppointmentStatus.PENDING_PAYMENT ||
    latestAppointment.paymentStatus !== PaymentStatus.PENDING ||
    !latestAppointment.holdExpiresAt ||
    latestAppointment.holdExpiresAt <= new Date()
  ) {
    throw new AppError("Appointment is no longer eligible for payment", 409);
  }

  // =====================================================
  // 10. CREATE LOCAL PAYMENT ATTEMPT
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
  // 11. CREATE STRIPE PAYMENT INTENT
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
    // 12. SAVE STRIPE PAYMENT INTENT ID
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
    // Stripe operation failed.
    // Preserve payment audit trail.
    // ===================================================

    await prisma.payment.updateMany({
      where: {
        id: payment.id,
        status: PaymentStatus.PENDING,
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
    event = await stripe.webhooks.constructEventAsync(
      payload,
      signature,
      config.stripe_webhook_secret,
    );
  } catch (error) {
    console.error("STRIPE WEBHOOK VERIFICATION FAILED", {
      code: "STRIPE_SIGNATURE_INVALID",
      payloadIsBuffer: Buffer.isBuffer(payload),
      payloadLength: payload.length,
      signaturePresent: Boolean(signature),
      webhookSecretConfigured: Boolean(config.stripe_webhook_secret),
    });

    throw new AppError("Invalid Stripe webhook signature", 400);
  }

  // Refund notifications may arrive after a timeout or a crash before local finalization.
  if (["refund.created", "refund.updated", "refund.failed"].includes(event.type)) {
    const providerRefund = event.data.object as Stripe.Refund;
    const local = await prisma.refund.findFirst({ where: { reason: "LATE_GROUP_PURCHASE_PAYMENT", OR: [{ providerRefundId: providerRefund.id }, ...(providerRefund.metadata?.refundId ? [{ id: providerRefund.metadata.refundId }] : [])] }, include: { payment: true } });
    if (local?.payment.providerPaymentId) {
      const intent = await stripe.paymentIntents.retrieve(local.payment.providerPaymentId);
      return handleGroupPurchaseStripeEvent(event, intent);
    }
    const approved = await prisma.refund.findFirst({ where: { OR: [{ providerRefundId: providerRefund.id }, ...(providerRefund.metadata?.refundId ? [{ id: providerRefund.metadata.refundId }] : [])] }, include: { refundRequest: true, payment: true } });
    if (approved?.refundRequest && approved.payment.purpose === PaymentPurpose.GROUP_PURCHASE) {
      const result = await reconcileApprovedStripeRefund(approved.refundRequest.id);
      if (result.status !== "COMPLETED") throw new AppError("Stripe refund is still pending", 503);
    }
    return { received: true };
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

      // ===============================================
      // PAYMENT -> PAID
      // ===============================================

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

      // ===============================================
      // APPOINTMENT PAYMENT
      // ===============================================

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

            // NEW: GROUP PURCHASE PROTECTION
            groupPurchaseId: true,
          },
        });

        if (!appointment) {
          throw new AppError("Appointment not found", 404);
        }

        // =============================================
        // NEW: BLOCK GROUP PURCHASE-LINKED APPOINTMENTS
        // =============================================

        if (appointment.groupPurchaseId !== null) {
          throw new AppError(
            "Group Purchase-linked appointment cannot be settled through the normal appointment payment webhook",
            409,
          );
        }

        const now = new Date();

        // =============================================
        // PAY NOW PAYMENT
        // =============================================

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
                appointmentId: appointment.id,
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

        // =============================================
        // DEPOSIT PAYMENT
        // =============================================

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
                appointmentId: appointment.id,
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

      // ===============================================
      // WALLET TOP-UP PAYMENT
      // ===============================================

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

      // ===============================================
      // MARK WEBHOOK PROCESSED
      // ===============================================

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
              appointmentId: latePayment.appointmentId ?? undefined,
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

        logUnexpectedError(error, {
          source:
            "src/app/module/payment/payment.service.ts:handleStripeWebhook",
        });

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
                appointmentId: currentPayment.appointmentId ?? undefined,
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
  // 1. FIND PURCHASE
  // =====================================================

  const purchase = await prisma.groupPurchase.findUnique({
    where: { id: purchaseId },
    select: {
      id: true,
      customerId: true,
      amount: true,
      purchaseFlow: true,
      bookingMethod: true,
      depositAmount: true,
      paymentStatus: true,
      reservationExpiresAt: true,
    },
  });

  if (!purchase) {
    throw new AppError("Group purchase not found", 404);
  }

  if (purchase.customerId !== customerId) {
    throw new AppError(
      "You are not allowed to pay for this group purchase",
      403,
    );
  }

  // =====================================================
  // 2. VALIDATE PURCHASE FLOW AND BOOKING METHOD
  // =====================================================

  const isBookNow =
    purchase.purchaseFlow === GroupPurchaseFlow.BUY_NOW_BOOK_NOW;

  if (
    purchase.purchaseFlow !== GroupPurchaseFlow.BUY_NOW_BOOK_LATER &&
    purchase.purchaseFlow !== GroupPurchaseFlow.BUY_NOW_BOOK_NOW
  ) {
    throw new AppError("Unsupported purchase flow", 422);
  }

  if (isBookNow) {
    if (purchase.bookingMethod === BookingMethod.RESERVE_NOW) {
      throw new AppError(
        "RESERVE_NOW does not require an initial Stripe payment",
        422,
      );
    }

    if (
      purchase.bookingMethod !== BookingMethod.PAY_NOW &&
      purchase.bookingMethod !== BookingMethod.DEPOSIT
    ) {
      throw new AppError("Unsupported Book Now booking method", 422);
    }

    if (!config.enable_book_now_purchase) {
      throw new AppError("Book Now Stripe settlement is not enabled yet", 422);
    }
  }

  // =====================================================
  // 3. VALIDATE PAYMENT STATE
  // =====================================================

  if (purchase.paymentStatus !== PaymentStatus.PENDING) {
    throw new AppError("Group purchase is not awaiting payment", 409);
  }

  const now = new Date();

  if (!purchase.reservationExpiresAt || purchase.reservationExpiresAt <= now) {
    throw new AppError("Group purchase payment reservation has expired", 409);
  }

  // =====================================================
  // 4. DETERMINE PAYMENT AMOUNT
  // =====================================================

  let paymentAmount = purchase.amount;

  if (isBookNow && purchase.bookingMethod === BookingMethod.DEPOSIT) {
    if (
      !purchase.depositAmount ||
      purchase.depositAmount.lte(0) ||
      purchase.depositAmount.gte(purchase.amount)
    ) {
      throw new AppError("Invalid package deposit amount", 422);
    }

    paymentAmount = purchase.depositAmount;
  }

  const amountInCents = paymentAmount.mul(100).toNumber();

  if (!Number.isSafeInteger(amountInCents) || amountInCents < 400) {
    throw new AppError("Invalid Stripe payment amount", 422);
  }

  // =====================================================
  // 5. FIND EXISTING PENDING STRIPE PAYMENT
  // =====================================================

  // Serialize local intent identity. Concurrent requests share one payment and Stripe key.
  let payment: Prisma.PaymentGetPayload<{}> | undefined;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      payment = await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT "id" FROM "GroupPurchase" WHERE "id" = ${purchaseId} FOR UPDATE`;
        const current = await tx.groupPurchase.findUnique({ where: { id: purchaseId } });
        if (!current || current.customerId !== customerId || current.paymentStatus !== PaymentStatus.PENDING || !current.reservationExpiresAt || current.reservationExpiresAt <= new Date()) throw new AppError("Group purchase is no longer payable", 409);
        const pending = await tx.payment.findFirst({ where: { groupPurchaseId: purchaseId, customerId, purpose: PaymentPurpose.GROUP_PURCHASE, provider: PaymentProvider.STRIPE, status: PaymentStatus.PENDING }, orderBy: { createdAt: "asc" } });
        if (pending) {
          if (!pending.amount.equals(paymentAmount)) throw new AppError("Existing payment amount does not match purchase", 409);
          return pending;
        }
        return tx.payment.create({ data: { customerId, groupPurchaseId: purchaseId, purpose: PaymentPurpose.GROUP_PURCHASE, provider: PaymentProvider.STRIPE, amount: paymentAmount, currency: "HKD", status: PaymentStatus.PENDING } });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      break;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034" && attempt < 3) continue;
      throw error;
    }
  }
  if (!payment) throw new AppError("Group purchase payment conflict", 409);

  // =====================================================
  // 7. REUSE OR CREATE STRIPE PAYMENT INTENT
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
            purchaseFlow: purchase.purchaseFlow,
            bookingMethod: purchase.bookingMethod ?? "NONE",
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
        where: { id: payment.id },
        data: {
          providerPaymentId: paymentIntent.id,
        },
      });
    }

    // =====================================================
    // 8. VERIFY STRIPE PAYMENT INTENT
    // =====================================================

    const payableStatuses = [
      "requires_payment_method",
      "requires_confirmation",
      "requires_action",
    ];

    if (
      paymentIntent.amount !== amountInCents ||
      paymentIntent.currency.toLowerCase() !== payment.currency.toLowerCase() ||
      paymentIntent.metadata?.paymentId !== payment.id ||
      paymentIntent.metadata?.groupPurchaseId !== purchaseId ||
      paymentIntent.metadata?.customerId !== customerId ||
      paymentIntent.metadata?.purpose !== PaymentPurpose.GROUP_PURCHASE
    ) {
      throw new AppError("Stripe PaymentIntent does not match purchase", 409);
    }

    if (
      !paymentIntent.client_secret ||
      !payableStatuses.includes(paymentIntent.status)
    ) {
      throw new AppError("Stripe PaymentIntent is not in a payable state", 409);
    }

    // =====================================================
    // 9. RECHECK PURCHASE AFTER STRIPE NETWORK CALL
    // =====================================================

    const currentPurchase = await prisma.groupPurchase.findUnique({
      where: { id: purchaseId },
      select: {
        paymentStatus: true,
        reservationExpiresAt: true,
        purchaseFlow: true,
        bookingMethod: true,
        amount: true,
        depositAmount: true,
      },
    });

    if (
      !currentPurchase ||
      currentPurchase.purchaseFlow !== purchase.purchaseFlow ||
      currentPurchase.bookingMethod !== purchase.bookingMethod ||
      currentPurchase.paymentStatus !== PaymentStatus.PENDING ||
      !currentPurchase.reservationExpiresAt ||
      currentPurchase.reservationExpiresAt <= new Date()
    ) {
      throw new AppError(
        "Group purchase reservation is no longer payable",
        409,
      );
    }

    const currentExpectedAmount =
      currentPurchase.purchaseFlow === GroupPurchaseFlow.BUY_NOW_BOOK_NOW &&
      currentPurchase.bookingMethod === BookingMethod.DEPOSIT
        ? currentPurchase.depositAmount
        : currentPurchase.amount;

    if (
      !currentExpectedAmount ||
      !currentExpectedAmount.equals(paymentAmount)
    ) {
      throw new AppError("Group purchase payable amount changed", 409);
    }

    // =====================================================
    // 10. RESPONSE
    // =====================================================

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

    logUnexpectedError(error, {
      source:
        "src/app/module/payment/payment.service.ts:createGroupPurchaseStripeIntent",
    });

    throw new AppError(
      "Unable to create Group Purchase Stripe PaymentIntent",
      502,
    );
  }
};

export const handleGroupPurchaseStripeEvent = async (
  event: Stripe.Event,
  paymentIntent: Stripe.PaymentIntent,
) => {
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

  const expectedCents = payment.amount.mul(100).toNumber();

  if (
    payment.provider !== PaymentProvider.STRIPE ||
    paymentIntent.currency.toLowerCase() !== payment.currency.toLowerCase() ||
    paymentIntent.amount !== expectedCents ||
    paymentIntent.metadata?.paymentId !== payment.id ||
    paymentIntent.metadata?.groupPurchaseId !== payment.groupPurchaseId ||
    paymentIntent.metadata?.customerId !== payment.customerId ||
    paymentIntent.metadata?.purpose !== PaymentPurpose.GROUP_PURCHASE
  ) {
    throw new AppError("Stripe payment verification failed", 409);
  }

  // =====================================================
  // 1. HANDLE PAYMENT FAILURE
  // =====================================================

  if (event.type === "payment_intent.payment_failed") {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await prisma.$transaction(
          async (tx) => {
            const existing = await tx.stripeWebhookEvent.findUnique({
              where: { id: event.id },
            });

            if (existing) return;

            await tx.payment.updateMany({
              where: {
                id: payment.id,
                status: PaymentStatus.PENDING,
              },
              data: {
                status: PaymentStatus.FAILED,
                failedAt: new Date(),
              },
            });

            await tx.stripeWebhookEvent.create({
              data: {
                id: event.id,
                type: event.type,
              },
            });
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          },
        );

        break;
      } catch (error) {
        const retryable =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2034";

        if (retryable && attempt < 3) continue;
        throw error;
      }
    }

    return { received: true as const };
  }

  if (!["payment_intent.succeeded", "refund.created", "refund.updated", "refund.failed"].includes(event.type)) {
    return { received: true as const };
  }

  if (
    paymentIntent.status !== "succeeded" ||
    paymentIntent.amount_received !== expectedCents
  ) {
    throw new AppError("Stripe payment was not successful", 409);
  }

  // =====================================================
  // 2. SETTLEMENT
  // =====================================================

  type SettlementResult =
    | "SETTLED"
    | "ALREADY_SETTLED"
    | "REFUND_REQUIRED"
    | "EVENT_PROCESSED";

  let settlementResult: SettlementResult | null = null;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      settlementResult = await prisma.$transaction(
        async (tx): Promise<SettlementResult> => {
          const existingEvent = await tx.stripeWebhookEvent.findUnique({
            where: { id: event.id },
          });

          if (existingEvent) {
            return "EVENT_PROCESSED";
          }

          const currentPayment = await tx.payment.findUnique({
            where: { id: payment.id },
          });

          const purchase = await tx.groupPurchase.findUnique({
            where: { id: payment.groupPurchaseId! },
            include: {
              appointments: {
                select: {
                  id: true,
                  bookingMethod: true,
                  appointmentStatus: true,
                  paymentStatus: true,
                },
              },
            },
          });

          if (!currentPayment || !purchase) {
            throw new AppError("Payment or purchase not found", 404);
          }

          const isBookNow =
            purchase.purchaseFlow === GroupPurchaseFlow.BUY_NOW_BOOK_NOW;

          const isDeposit =
            isBookNow && purchase.bookingMethod === BookingMethod.DEPOSIT;

          if (
            isBookNow &&
            purchase.bookingMethod !== BookingMethod.PAY_NOW &&
            purchase.bookingMethod !== BookingMethod.DEPOSIT
          ) {
            throw new AppError(
              "Unsupported Book Now Stripe payment method",
              409,
            );
          }

          const expectedAmount = isDeposit
            ? purchase.depositAmount
            : purchase.amount;

          if (
            purchase.customerId !== currentPayment.customerId ||
            !expectedAmount ||
            !expectedAmount.equals(currentPayment.amount)
          ) {
            throw new AppError("Group purchase payment mismatch", 409);
          }

          const initialAppointments = purchase.appointments.filter(item => item.bookingMethod === purchase.bookingMethod);
          const appointment = isBookNow ? initialAppointments[0] : null;

          if (
            isBookNow &&
            (initialAppointments.length !== 1 ||
              !appointment ||
              appointment.bookingMethod !== purchase.bookingMethod)
          ) {
            throw new AppError("Invalid Book Now initial appointment", 409);
          }

          const expectedPurchaseStatus = isDeposit
            ? PaymentStatus.PARTIALLY_PAID
            : PaymentStatus.PAID;

          const now = new Date();

          // A duplicate payment must never change which payment settled this purchase.
          if (purchase.purchasedAt && [PaymentStatus.PAID, PaymentStatus.PARTIALLY_PAID, PaymentStatus.REFUNDED, PaymentStatus.PARTIALLY_REFUNDED].some(status => status === purchase.paymentStatus)) {
            if (!purchase.settledPaymentId) throw new AppError("Legacy group settlement identity requires manual reconciliation", 503);
            if (purchase.settledPaymentId === currentPayment.id) {
              if (![PaymentStatus.PAID, PaymentStatus.REFUNDED, PaymentStatus.PARTIALLY_REFUNDED].some(status => status === currentPayment.status)) throw new AppError("Group settlement payment state requires reconciliation", 503);
              await tx.stripeWebhookEvent.create({ data: { id: event.id, type: event.type } });
              return "ALREADY_SETTLED";
            }
          }
          if ([PaymentStatus.REFUNDED, PaymentStatus.PARTIALLY_REFUNDED].includes(currentPayment.status as "REFUNDED" | "PARTIALLY_REFUNDED")) return "REFUND_REQUIRED";

          // =================================================
          // 4. CHECK ACTIVE RESERVATION
          // =================================================

          const activeReservation =
            purchase.paymentStatus === PaymentStatus.PENDING &&
            purchase.reservationExpiresAt !== null &&
            purchase.reservationExpiresAt > now;

          const otherPaidPayments = await tx.payment.count({
            where: {
              groupPurchaseId: purchase.id,
              purpose: PaymentPurpose.GROUP_PURCHASE,
              status: PaymentStatus.PAID,
              id: { not: currentPayment.id },
            },
          });

          if (!activeReservation || otherPaidPayments > 0) {
            if (currentPayment.status !== PaymentStatus.REFUNDED) {
              await tx.payment.update({
                where: { id: currentPayment.id },
                data: {
                  status: PaymentStatus.PAID,
                  paidAt: currentPayment.paidAt ?? now,
                  failedAt: null,
                },
              });
            }

            if (
              purchase.paymentStatus === PaymentStatus.PENDING &&
              !activeReservation &&
              otherPaidPayments === 0
            ) {
              const changed = await tx.groupPurchase.updateMany({
                where: {
                  id: purchase.id,
                  paymentStatus: PaymentStatus.PENDING,
                },
                data: {
                  paymentStatus: PaymentStatus.FAILED,
                  reservationExpiresAt: null,
                },
              });

              if (changed.count === 1) {
                if (isBookNow && appointment) {
                  const expired = await tx.appointment.updateMany({
                    where: {
                      id: appointment.id,
                      groupPurchaseId: purchase.id,
                      appointmentStatus: AppointmentStatus.PENDING_PAYMENT,
                      paymentStatus: PaymentStatus.PENDING,
                    },
                    data: {
                      appointmentStatus: AppointmentStatus.EXPIRED,
                      paymentStatus: PaymentStatus.FAILED,
                      holdExpiresAt: null,
                      qrToken: null,
                    },
                  });

                  if (expired.count !== 1) {
                    throw new AppError(
                      "Unable to expire Book Now appointment",
                      409,
                    );
                  }
                }

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

            return "REFUND_REQUIRED";
          }

          // =================================================
          // 5. VALIDATE APPOINTMENT
          // =================================================

          if (isBookNow && appointment) {
            if (
              appointment.appointmentStatus !==
                AppointmentStatus.PENDING_PAYMENT ||
              appointment.paymentStatus !== PaymentStatus.PENDING
            ) {
              throw new AppError(
                "Book Now appointment is not awaiting payment",
                409,
              );
            }
          }

          // =================================================
          // 6. SETTLE PURCHASE
          // =================================================

          const updatedPurchase = await tx.groupPurchase.updateMany({
            where: {
              id: purchase.id,
              paymentStatus: PaymentStatus.PENDING,
              reservationExpiresAt: { gt: now },
            },
            data: {
              paymentStatus: expectedPurchaseStatus,
              settledPaymentId: currentPayment.id,
              purchasedAt: now,
              reservationExpiresAt: null,
            },
          });

          if (updatedPurchase.count !== 1) {
            throw new AppError("Purchase settlement conflict", 409);
          }

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

          // =================================================
          // 7. UPDATE BOOK NOW APPOINTMENT
          // =================================================

          if (isBookNow && appointment) {
            const appointmentStatus = isDeposit
              ? AppointmentStatus.RESERVED
              : AppointmentStatus.CONFIRMED;

            const appointmentPaymentStatus = isDeposit
              ? PaymentStatus.PARTIALLY_PAID
              : PaymentStatus.PAID;

            const qrToken = isDeposit
              ? crypto.randomBytes(32).toString("hex")
              : null;

            const updatedAppointment = await tx.appointment.updateMany({
              where: {
                id: appointment.id,
                groupPurchaseId: purchase.id,
                appointmentStatus: AppointmentStatus.PENDING_PAYMENT,
                paymentStatus: PaymentStatus.PENDING,
              },
              data: {
                appointmentStatus,
                paymentStatus: appointmentPaymentStatus,
                holdExpiresAt: null,
                qrToken,
              },
            });

            if (updatedAppointment.count !== 1) {
              throw new AppError("Unable to confirm Book Now appointment", 409);
            }
          }

          // =================================================
          // 8. MARK PAYMENT PAID
          // =================================================

          await tx.payment.update({
            where: { id: currentPayment.id },
            data: {
              status: PaymentStatus.PAID,
              paidAt: now,
              failedAt: null,
            },
          });

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

      if (retryable && attempt < 3) continue;
      throw error;
    }
  }

  if (
    settlementResult === "SETTLED" ||
    settlementResult === "ALREADY_SETTLED" ||
    settlementResult === "EVENT_PROCESSED"
  ) {
    return { received: true as const };
  }

  if (settlementResult !== "REFUND_REQUIRED") {
    throw new AppError("Group purchase settlement outcome unknown", 503);
  }

  // =====================================================
  // 9. LATE / DUPLICATE PAYMENT REFUND
  // =====================================================

  const localRefund = await getOrCreateLateGroupPurchaseRefund(
    payment.id,
    payment.amount,
  );

  let providerRefundId: string | null;
  try {
    const result = await ensureLateGroupPurchaseRefund(localRefund.id);
    if (result.requiresInvestigation || result.status !== RefundStatus.SUCCEEDED || !result.providerRefundId) {
      throw new AppError("Stripe refund pending or requires investigation", 503);
    }
    providerRefundId = result.providerRefundId;
  } catch (error) {
    logUnexpectedError(error, { source: "handleGroupPurchaseStripeEvent:lateRefund" });
    if (error instanceof AppError) throw error;
    throw new AppError("Stripe refund outcome is uncertain; reconciliation required", 503);
  }

  // =====================================================
  // 11. FINALIZE REFUND LOCALLY
  // =====================================================

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT "id" FROM "Payment" WHERE "id" = ${payment.id} FOR UPDATE`;
          const currentRefund = await tx.refund.findUnique({
            where: {
              id: localRefund.id,
            },
          });

          if (!currentRefund) {
            throw new AppError("Refund not found", 404);
          }

          const currentPayment = await tx.payment.findUnique({
            where: {
              id: payment.id,
            },
          });

          if (!currentPayment) {
            throw new AppError("Payment not found", 404);
          }

          if (
            currentRefund.providerRefundId &&
            currentRefund.providerRefundId !== providerRefundId
          ) {
            throw new AppError("Refund provider ID mismatch", 409);
          }

          const alreadyFinalized =
            currentRefund.status === RefundStatus.SUCCEEDED &&
            currentPayment.status === PaymentStatus.REFUNDED;

          const refundedAt = currentRefund.refundedAt ?? new Date();

          if (!alreadyFinalized) {
            // ---------------------------------------------
            // 11.1 REFUND -> SUCCEEDED
            // ---------------------------------------------

            await tx.refund.update({
              where: {
                id: currentRefund.id,
              },
              data: {
                providerRefundId,
                status: RefundStatus.SUCCEEDED,
                refundedAt,
              },
            });

            // ---------------------------------------------
            // 11.2 PAYMENT -> REFUNDED
            // ---------------------------------------------

            await tx.payment.update({
              where: {
                id: currentPayment.id,
              },
              data: {
                status: PaymentStatus.REFUNDED,
                refundedAt,
              },
            });

            await auditLogService.createAuditLog({ userId: null, action: "LATE_GROUP_PURCHASE_REFUNDED", entityType: "PAYMENT", entityId: payment.id, metadata: { refundId: currentRefund.id, providerRefundId, amount: Number(currentRefund.amount), currency: payment.currency } }, tx);

            // ---------------------------------------------
            // 11.3 CUSTOMER NOTIFICATION
            // ---------------------------------------------

            const translations = notificationTemplates.LATE_GROUP_REFUND(
              Number(payment.amount),
              payment.currency,
            );

            await notificationService.createNotification(
              {
                appointmentId: payment.appointmentId ?? undefined,
                userId: payment.customerId,
                type: "REFUND_COMPLETED",
                title: translations.en!.title!,
                message: translations.en!.message!,
                translations,
              },
              tx,
            );
          }

          // -----------------------------------------------
          // 11.4 MARK WEBHOOK PROCESSED
          // -----------------------------------------------

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

  if (!Number.isInteger(page) || page < 1) {
    throw new AppError("page must be at least 1", 400);
  }

  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
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
  // 3. FETCH PAYMENTS + TOTAL COUNT
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

        // G6 - NEW FIELDS
        createdAt: true,
        purpose: true,
        groupPurchaseId: true,
      },
    }),

    prisma.payment.count({
      where,
    }),
  ]);

  // =====================================================
  // 4. FETCH SUCCESSFUL REFUND TOTALS
  // =====================================================

  const paymentIds = payments.map((payment) => payment.id);

  const refundTotals =
    paymentIds.length > 0
      ? await prisma.refund.groupBy({
          by: ["paymentId"],

          where: {
            paymentId: {
              in: paymentIds,
            },

            status: RefundStatus.SUCCEEDED,
          },

          _sum: {
            amount: true,
          },
        })
      : [];

  // =====================================================
  // 5. REFUND AMOUNT LOOKUP MAP
  // =====================================================

  const refundedAmountMap = new Map<string, number>();

  for (const refund of refundTotals) {
    refundedAmountMap.set(refund.paymentId, Number(refund._sum.amount ?? 0));
  }

  // =====================================================
  // 6. PAYMENT LABEL MAPPING
  // =====================================================

  const paymentLabels: Record<PaymentPurpose, string> = {
    [PaymentPurpose.APPOINTMENT]: "Appointment Payment",

    [PaymentPurpose.GROUP_PURCHASE]: "Group Purchase",

    [PaymentPurpose.WALLET_TOP_UP]: "Wallet Top Up",

    [PaymentPurpose.APPOINTMENT_DEPOSIT]: "Appointment Deposit",

    [PaymentPurpose.APPOINTMENT_REMAINING]: "Appointment Remaining Payment",
  };

  // =====================================================
  // 7. RESPONSE DTO
  // =====================================================

  const items: IMyPaymentItem[] = payments.map((payment) => ({
    id: payment.id,

    amount: Number(payment.amount),

    currency: payment.currency,

    paymentStatus: payment.status,

    provider: payment.provider,

    providerPaymentId: payment.providerPaymentId,

    appointmentId: payment.appointmentId,

    // G6 - NEW FIELDS

    createdAt: payment.createdAt,

    purpose: payment.purpose,

    groupPurchaseId: payment.groupPurchaseId,

    label: paymentLabels[payment.purpose] ?? "Payment",

    refundedAmount: refundedAmountMap.get(payment.id) ?? 0,
  }));

  // =====================================================
  // 8. PAGINATION RESPONSE
  // =====================================================

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

const refundWalletPayment = async (
  paymentId: string,
  userId: string,
  payload: IRefundPaymentPayload,
): Promise<IRefundPaymentResponse> => {
  // Retry serialization conflicts safely.
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          // ==========================================
          // 1. LOCK PAYMENT ROW
          // ==========================================

          const lockedRows = await tx.$queryRaw<Array<{ id: string }>>`
            SELECT "id"
            FROM "Payment"
            WHERE "id" = ${paymentId}
            FOR UPDATE
          `;

          if (lockedRows.length !== 1) {
            throw new AppError("PAYMENT_NOT_FOUND", 404);
          }

          // ==========================================
          // 2. LOAD PAYMENT
          // ==========================================

          const payment = await tx.payment.findUniqueOrThrow({
            where: { id: paymentId },
          });

          if (payment.provider !== PaymentProvider.WALLET) {
            throw new AppError("REFUND_NOT_ALLOWED", 409);
          }

          if (
            payment.status !== PaymentStatus.PAID &&
            payment.status !== PaymentStatus.PARTIALLY_REFUNDED
          ) {
            throw new AppError("REFUND_NOT_ALLOWED", 409);
          }

          if (
            payment.purpose !== PaymentPurpose.APPOINTMENT &&
            payment.purpose !== PaymentPurpose.GROUP_PURCHASE
          ) {
            throw new AppError("REFUND_NOT_ALLOWED", 409);
          }

          // ==========================================
          // 3. VALIDATE REQUEST
          // ==========================================

          const refundAmount = new Prisma.Decimal(payload.amount);

          const refundReason = payload.reason?.trim();

          if (
            !refundAmount.isFinite() ||
            refundAmount.lte(0) ||
            !refundAmount.mul(100).isInteger()
          ) {
            throw new AppError("REFUND_AMOUNT_INVALID", 400);
          }

          if (!refundReason) {
            throw new AppError("REFUND_REASON_REQUIRED", 400);
          }

          // ==========================================
          // 4. FIND WALLET
          // ==========================================

          const wallet = await tx.wallet.findUnique({
            where: {
              customerId: payment.customerId,
            },
          });

          if (!wallet) {
            throw new AppError("WALLET_NOT_FOUND", 404);
          }

          if (wallet.currency !== payment.currency) {
            throw new AppError("WALLET_CURRENCY_MISMATCH", 409);
          }

          // ==========================================
          // 5. IDENTIFY ORIGINAL PAYMENT
          // ==========================================

          const referenceId =
            payment.purpose === PaymentPurpose.APPOINTMENT
              ? payment.appointmentId
              : payment.groupPurchaseId;

          const originalTransactionType =
            payment.purpose === PaymentPurpose.APPOINTMENT
              ? WalletTransactionType.APPOINTMENT_PAYMENT
              : WalletTransactionType.GROUP_PURCHASE_PAYMENT;

          if (!referenceId) {
            throw new AppError("WALLET_PAYMENT_REFERENCE_MISSING", 409);
          }

          // ==========================================
          // 6. READ ORIGINAL DEDUCTIONS
          // ==========================================

          const deductions = await tx.walletTransaction.findMany({
            where: {
              walletId: wallet.id,
              referenceId,
              type: originalTransactionType,
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

          const paymentAmount = payment.amount;

          // Do not refund when the original wallet
          // deduction cannot be reconciled.
          if (!paidSpent.plus(bonusSpent).equals(paymentAmount)) {
            throw new AppError("WALLET_PAYMENT_LEDGER_MISMATCH", 409);
          }

          // ==========================================
          // 7. CHECK PREVIOUS REFUNDS
          // ==========================================

          const previousRefunds = await tx.refund.findMany({
            where: { paymentId },
            select: {
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
            throw new AppError("REFUND_AMOUNT_INVALID", 400);
          }

          // ==========================================
          // 8. PROPORTIONAL REFUND CALCULATION
          // ==========================================

          // Work in integer cents to avoid rounding
          // drift across multiple partial refunds.

          const totalCents = paymentAmount.mul(100).toNumber();

          const paidCents = paidSpent.mul(100).toNumber();

          const refundedBeforeCents = alreadyRefunded.mul(100).toNumber();

          const refundedAfterCents = totalRefunded.mul(100).toNumber();

          if (
            ![
              totalCents,
              paidCents,
              refundedBeforeCents,
              refundedAfterCents,
            ].every(Number.isSafeInteger) ||
            totalCents <= 0
          ) {
            throw new AppError("WALLET_REFUND_ALLOCATION_INVALID", 409);
          }

          const cumulativePaidAllocation = (refundedCents: number): number => {
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
            cumulativePaidAllocation(refundedAfterCents) -
            cumulativePaidAllocation(refundedBeforeCents);

          const refundCents = refundAmount.mul(100).toNumber();

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

          // ==========================================
          // 9. CREATE REFUND RECORD
          // ==========================================

          const refundedAt = new Date();

          const refund = await tx.refund.create({
            data: {
              paymentId,
              amount: refundAmount,
              reason: refundReason,
              status: RefundStatus.SUCCEEDED,
              refundedAt,
            },
          });

          // ==========================================
          // 10. RESTORE WALLET BALANCES
          // ==========================================

          await tx.wallet.update({
            where: {
              id: wallet.id,
            },
            data: {
              paidBalance: {
                increment: paidRefund,
              },
              bonusBalance: {
                increment: bonusRefund,
              },
            },
          });

          // ==========================================
          // 11. WALLET REFUND LEDGER
          // ==========================================

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

          // ==========================================
          // 12. UPDATE PAYMENT STATUS
          // ==========================================

          const fullyRefunded = totalRefunded.equals(paymentAmount);

          const newPaymentStatus = fullyRefunded
            ? PaymentStatus.REFUNDED
            : PaymentStatus.PARTIALLY_REFUNDED;

          await tx.payment.update({
            where: { id: paymentId },
            data: {
              status: newPaymentStatus,
              refundedAt: fullyRefunded ? refundedAt : payment.refundedAt,
            },
          });

          // ==========================================
          // 13. CUSTOMER NOTIFICATION
          // ==========================================

          const translations = notificationTemplates.REFUND_COMPLETED(
            refundAmount.toNumber(),
            payment.currency,
          );

          await notificationService.createNotification(
            {
              appointmentId: payment.appointmentId ?? undefined,
              userId: payment.customerId,
              type: "REFUND_COMPLETED",
              title: translations.en!.title!,
              message: translations.en!.message!,
              translations,
            },
            tx,
          );

          // ==========================================
          // 14. AUDIT LOG
          // ==========================================

          await auditLogService.createAuditLog(
            {
              userId,
              action: "REFUND_PROCESSED",
              entityType: "PAYMENT",
              entityId: paymentId,
              metadata: {
                refundId: refund.id,
                provider: PaymentProvider.WALLET,
                amount: refundAmount.toNumber(),
                paidBalanceRefunded: paidRefund.toNumber(),
                bonusBalanceRefunded: bonusRefund.toNumber(),
                currency: payment.currency,
                reason: refundReason,
                previousPaymentStatus: payment.status,
                newPaymentStatus,
                alreadyRefunded: alreadyRefunded.toNumber(),
                totalRefunded: totalRefunded.toNumber(),
                fullyRefunded,
              },
            },
            tx,
          );

          // ==========================================
          // 15. RESPONSE
          // ==========================================

          return {
            paymentId,
            refundId: refund.id,
            refundStatus: "SUCCEEDED" as const,
            amount: refundAmount.toNumber(),
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

const refundPayment = async (
  paymentId: string,
  userId: string,
  payload: IRefundPaymentPayload,
): Promise<IRefundPaymentResponse> => {
  // =====================================================
  // 1. VERIFY PAYMENT EXISTS
  // =====================================================

  const payment = await prisma.payment.findUnique({
    where: {
      id: paymentId,
    },
    select: {
      id: true,
    },
  });

  if (!payment) {
    throw new AppError("PAYMENT_NOT_FOUND", 404);
  }

  // =====================================================
  // 2. ENFORCE REFUND REQUEST APPROVAL WORKFLOW
  // =====================================================

  // Direct payment refunds are disabled.
  //
  // Required flow:
  // 1. Customer creates RefundRequest
  // 2. Authorized reviewer approves
  // 3. processApprovedRefund() executes the refund
  //
  // This prevents bypassing approval for both
  // STRIPE and WALLET payments.

  throw new AppError("DIRECT_REFUND_DISABLED_USE_REFUND_REQUEST", 403);
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
