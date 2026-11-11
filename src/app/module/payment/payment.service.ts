import {
  stripeAmount,
  getPurchaseCurrency,
  currencyDigits,
  assertCurrencyAmount,
  assertSameCurrency,
} from "../../utils/transaction-currency.utils.js";
import { reconcileUnappliedCapture } from "./unapplied-capture.js";
import { reconcileApprovedStripeRefund } from "../refund-request/refund-request.processing.js";
import { reconcileRefundAllocation } from "../refund-request/refund-allocation.processing.js";
import {
  getOrCreateLateGroupPurchaseRefund,
  ensureLateGroupPurchaseRefund,
} from "./late-group-refund.js";
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
import {
  getPaymentRefundEligibility,
  getPaymentsRefundEligibilityBatch,
} from "../cancellation-refund/cancellation-refund.service.js";
import { getLocalizedContent } from "../../utils/localization.js";
import { DEFAULT_LANGUAGE, Language } from "../../utils/language.js";

const createStripeIntent = async (
  customerId: string,
  payload: ICreateStripeIntentPayload,
): Promise<ICreateStripeIntentResponse> => {
  const appointmentId = payload.appointmentId;

  // =====================================================
  // 1. FIND APPOINTMENT
  // =====================================================

  const appointment = await prisma.appointment.findUnique({
    where: {
      id: appointmentId,
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
  // 3. BLOCK GROUP PURCHASE APPOINTMENTS
  // =====================================================

  if (appointment.groupPurchaseId !== null) {
    throw new AppError(
      "Group Purchase-linked appointments must use the Group Purchase payment flow",
      409,
    );
  }

  // =====================================================
  // 4. VALIDATE BOOKING METHOD
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
  // 5. VALIDATE APPOINTMENT PAYMENT STATE
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
  // 6. VALIDATE ACTIVE HOLD
  // =====================================================

  if (!appointment.holdExpiresAt || appointment.holdExpiresAt <= new Date()) {
    throw new AppError("Appointment payment hold has expired", 409);
  }

  // =====================================================
  // 7. DETERMINE PAYMENT PURPOSE AND AMOUNT
  // =====================================================

  const paymentPurpose =
    appointment.bookingMethod === BookingMethod.PAY_NOW
      ? PaymentPurpose.APPOINTMENT
      : PaymentPurpose.APPOINTMENT_DEPOSIT;

  let paymentAmount = appointment.price;

  if (appointment.bookingMethod === BookingMethod.DEPOSIT) {
    if (
      !appointment.depositAmount ||
      appointment.depositAmount.lte(0) ||
      appointment.depositAmount.gte(appointment.price)
    ) {
      throw new AppError("Invalid deposit amount for this appointment", 422);
    }

    paymentAmount = appointment.depositAmount;
  }

  // Always use the appointment currency snapshot.
  const currency = appointment.currency;

  assertCurrencyAmount(paymentAmount, currency);

  const amountInCents = stripeAmount(paymentAmount, currency);

  if (!Number.isSafeInteger(amountInCents) || amountInCents <= 0) {
    throw new AppError("Invalid Stripe payment amount", 422);
  }

  // =====================================================
  // 8. CREATE OR REUSE LOCAL PAYMENT ATOMICALLY
  // =====================================================

  let payment: Prisma.PaymentGetPayload<{}> | undefined;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      payment = await prisma.$transaction(
        async (tx) => {
          // Serialize payment creation for this appointment.
          await tx.$queryRaw`
            SELECT "id"
            FROM "Appointment"
            WHERE "id" = ${appointmentId}
            FOR UPDATE
          `;

          const current = await tx.appointment.findUnique({
            where: {
              id: appointmentId,
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
              currency: true,
              holdExpiresAt: true,
            },
          });

          if (
            !current ||
            current.customerId !== customerId ||
            current.groupPurchaseId !== null ||
            current.bookingMethod !== appointment.bookingMethod ||
            current.appointmentStatus !== AppointmentStatus.PENDING_PAYMENT ||
            current.paymentStatus !== PaymentStatus.PENDING ||
            !current.holdExpiresAt ||
            current.holdExpiresAt <= new Date()
          ) {
            throw new AppError(
              "Appointment is no longer eligible for payment",
              409,
            );
          }

          // =================================================
          // 8.1 VERIFY AMOUNT AND CURRENCY SNAPSHOT
          // =================================================

          if (
            current.currency !== currency ||
            !current.price.equals(appointment.price) ||
            (current.depositAmount === null
              ? appointment.depositAmount !== null
              : appointment.depositAmount === null ||
                !current.depositAmount.equals(appointment.depositAmount))
          ) {
            throw new AppError(
              "Appointment payment amount or currency changed",
              409,
            );
          }

          const currentExpectedAmount =
            current.bookingMethod === BookingMethod.PAY_NOW
              ? current.price
              : current.depositAmount;

          if (
            !currentExpectedAmount ||
            !currentExpectedAmount.equals(paymentAmount)
          ) {
            throw new AppError("Appointment payable amount changed", 409);
          }

          // =================================================
          // 8.2 FIND EXISTING PENDING STRIPE PAYMENT
          // =================================================

          const pending = await tx.payment.findFirst({
            where: {
              appointmentId,
              customerId,
              purpose: paymentPurpose,
              provider: PaymentProvider.STRIPE,
              status: PaymentStatus.PENDING,
            },
            orderBy: {
              createdAt: "asc",
            },
          });

          if (pending) {
            if (
              !pending.amount.equals(paymentAmount) ||
              pending.currency !== currency
            ) {
              throw new AppError(
                "Existing pending payment amount or currency mismatch",
                409,
              );
            }

            return pending;
          }

          // =================================================
          // 8.3 BLOCK OTHER PENDING PAYMENT ATTEMPTS
          // =================================================

          const otherPending = await tx.payment.findFirst({
            where: {
              appointmentId,
              customerId,
              purpose: paymentPurpose,
              status: PaymentStatus.PENDING,
            },
          });

          if (otherPending) {
            throw new AppError(
              "Another payment attempt is already pending",
              409,
            );
          }

          // =================================================
          // 8.4 CREATE PAYMENT ATTEMPT
          // =================================================

          return tx.payment.create({
            data: {
              customerId,
              appointmentId,
              purpose: paymentPurpose,
              provider: PaymentProvider.STRIPE,
              amount: paymentAmount,
              currency,
              status: PaymentStatus.PENDING,
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

  if (!payment) {
    throw new AppError("Appointment payment creation conflict", 409);
  }

  // =====================================================
  // 9. VERIFY LOCAL PAYMENT SNAPSHOT
  // =====================================================

  if (
    payment.customerId !== customerId ||
    payment.appointmentId !== appointmentId ||
    payment.purpose !== paymentPurpose ||
    payment.provider !== PaymentProvider.STRIPE ||
    payment.status !== PaymentStatus.PENDING ||
    !payment.amount.equals(paymentAmount) ||
    payment.currency !== currency
  ) {
    throw new AppError("Appointment payment snapshot mismatch", 409);
  }

  // =====================================================
  // 10. CREATE OR REUSE STRIPE PAYMENT INTENT
  // =====================================================

  try {
    let paymentIntent: Stripe.PaymentIntent;

    if (payment.providerPaymentId) {
      // Reuse the existing Stripe intent.
      // Retrieval failure must not create another
      // payment attempt automatically.

      paymentIntent = await stripe.paymentIntents.retrieve(
        payment.providerPaymentId,
      );
    } else {
      // Stripe idempotency key is based on the stable
      // local payment ID.

      paymentIntent = await stripe.paymentIntents.create(
        {
          amount: amountInCents,
          currency: currency.toLowerCase(),

          metadata: {
            paymentId: payment.id,
            appointmentId,
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

      // =================================================
      // 10.1 SAVE STRIPE PAYMENT INTENT ID SAFELY
      // =================================================

      const updated = await prisma.payment.updateMany({
        where: {
          id: payment.id,
          status: PaymentStatus.PENDING,
          provider: PaymentProvider.STRIPE,
          providerPaymentId: null,
        },
        data: {
          providerPaymentId: paymentIntent.id,
        },
      });

      if (updated.count !== 1) {
        const latestPayment = await prisma.payment.findUnique({
          where: {
            id: payment.id,
          },
        });

        if (
          !latestPayment ||
          latestPayment.providerPaymentId !== paymentIntent.id
        ) {
          throw new AppError("Stripe PaymentIntent identity conflict", 409);
        }
      }
    }

    // =====================================================
    // 11. VERIFY STRIPE PAYMENT INTENT
    // =====================================================

    if (
      paymentIntent.amount !== amountInCents ||
      paymentIntent.currency.toLowerCase() !== currency.toLowerCase() ||
      paymentIntent.metadata?.paymentId !== payment.id ||
      paymentIntent.metadata?.appointmentId !== appointmentId ||
      paymentIntent.metadata?.customerId !== customerId ||
      paymentIntent.metadata?.purpose !== paymentPurpose
    ) {
      throw new AppError(
        "Stripe PaymentIntent does not match appointment",
        409,
      );
    }

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

    // =====================================================
    // 12. RECHECK APPOINTMENT AFTER STRIPE CALL
    // =====================================================

    const latestAppointment = await prisma.appointment.findUnique({
      where: {
        id: appointmentId,
      },
      select: {
        customerId: true,
        groupPurchaseId: true,
        bookingMethod: true,
        appointmentStatus: true,
        paymentStatus: true,
        price: true,
        depositAmount: true,
        currency: true,
        holdExpiresAt: true,
      },
    });

    if (
      !latestAppointment ||
      latestAppointment.customerId !== customerId ||
      latestAppointment.groupPurchaseId !== null ||
      latestAppointment.bookingMethod !== appointment.bookingMethod ||
      latestAppointment.appointmentStatus !==
        AppointmentStatus.PENDING_PAYMENT ||
      latestAppointment.paymentStatus !== PaymentStatus.PENDING ||
      !latestAppointment.holdExpiresAt ||
      latestAppointment.holdExpiresAt <= new Date()
    ) {
      throw new AppError("Appointment is no longer eligible for payment", 409);
    }

    // =====================================================
    // 13. RECHECK AMOUNT AND CURRENCY
    // =====================================================

    const latestExpectedAmount =
      latestAppointment.bookingMethod === BookingMethod.PAY_NOW
        ? latestAppointment.price
        : latestAppointment.depositAmount;

    if (
      latestAppointment.currency !== currency ||
      !latestExpectedAmount ||
      !latestExpectedAmount.equals(paymentAmount)
    ) {
      throw new AppError("Appointment payable amount or currency changed", 409);
    }

    // =====================================================
    // 14. RECHECK LOCAL PAYMENT
    // =====================================================

    const latestPayment = await prisma.payment.findUnique({
      where: {
        id: payment.id,
      },
      select: {
        customerId: true,
        appointmentId: true,
        purpose: true,
        provider: true,
        amount: true,
        currency: true,
        status: true,
        providerPaymentId: true,
      },
    });

    if (
      !latestPayment ||
      latestPayment.customerId !== customerId ||
      latestPayment.appointmentId !== appointmentId ||
      latestPayment.purpose !== paymentPurpose ||
      latestPayment.provider !== PaymentProvider.STRIPE ||
      latestPayment.status !== PaymentStatus.PENDING ||
      !latestPayment.amount.equals(paymentAmount) ||
      latestPayment.currency !== currency ||
      latestPayment.providerPaymentId !== paymentIntent.id
    ) {
      throw new AppError("Appointment payment is no longer payable", 409);
    }

    // =====================================================
    // 15. RESPONSE
    // =====================================================

    return {
      paymentId: payment.id,
      appointmentId,
      amount: Number(payment.amount),
      currency: payment.currency,
      paymentStatus: "PENDING",
      clientSecret: paymentIntent.client_secret,
    };
  } catch (error) {
    // =====================================================
    // 16. ERROR HANDLING
    // =====================================================

    // Do not mark the payment FAILED here.
    //
    // Stripe may already have created the intent,
    // even when the network response or DB update fails.
    //
    // The same payment ID and idempotency key allow
    // safe recovery on the next request.

    if (error instanceof AppError) {
      throw error;
    }

    logUnexpectedError(error, {
      source: "src/app/module/payment/payment.service.ts:createStripeIntent",
    });

    throw new AppError("Unable to create Stripe PaymentIntent", 502);
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

  // Refund notifications may arrive after a timeout
  // or a crash before local finalization.

  if (
    ["refund.created", "refund.updated", "refund.failed"].includes(event.type)
  ) {
    const providerRefund = event.data.object as Stripe.Refund;

    const processed = await prisma.stripeWebhookEvent.findUnique({
      where: { id: event.id },
    });

    if (processed) return { received: true };

    const allocation = await prisma.refundAllocation.findFirst({
      where: {
        OR: [
          { refund: { providerRefundId: providerRefund.id } },
          ...(providerRefund.metadata?.refundId
            ? [{ refundId: providerRefund.metadata.refundId }]
            : []),
          ...(providerRefund.metadata?.refundAllocationId
            ? [{ id: providerRefund.metadata.refundAllocationId }]
            : []),
        ],
      },
    });

    if (allocation) {
      await reconcileRefundAllocation(allocation.id);

      await prisma.stripeWebhookEvent.upsert({
        where: { id: event.id },
        create: { id: event.id, type: event.type },
        update: {},
      });

      return { received: true };
    }

    const local = await prisma.refund.findFirst({
      where: {
        reason: {
          in: [
            "LATE_GROUP_PURCHASE_PAYMENT",
            "LATE_PAYMENT_AFTER_APPOINTMENT_EXPIRY",
          ],
        },
        OR: [
          { providerRefundId: providerRefund.id },
          ...(providerRefund.metadata?.refundId
            ? [{ id: providerRefund.metadata.refundId }]
            : []),
        ],
      },
      include: { payment: true },
    });

    if (local?.payment.providerPaymentId) {
      const intent = await stripe.paymentIntents.retrieve(
        local.payment.providerPaymentId,
      );

      if (
        local.payment.appointmentId ||
        intent.metadata?.paymentStage === "REMAINING"
      ) {
        return reconcileUnappliedCapture(local.paymentId, event);
      }

      return handleGroupPurchaseStripeEvent(event, intent);
    }

    const approved = await prisma.refund.findFirst({
      where: {
        OR: [
          { providerRefundId: providerRefund.id },
          ...(providerRefund.metadata?.refundId
            ? [{ id: providerRefund.metadata.refundId }]
            : []),
        ],
      },
      include: { refundRequest: true, payment: true },
    });

    if (approved?.refundRequest) {
      const result = await reconcileApprovedStripeRefund(
        approved.refundRequest.id,
      );

      if (result.status !== "COMPLETED") {
        throw new AppError("Stripe refund is still pending", 503);
      }
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
      if (paymentIntent.metadata?.paymentStage === "REMAINING") {
        return handleGroupPurchaseRemainingStripeEvent(event, paymentIntent);
      }

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
      paymentIntent.amount !== stripeAmount(payment.amount, payment.currency) ||
      paymentIntent.amount_received !==
        stripeAmount(payment.amount, payment.currency)
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
      if (payment.appointmentId) {
        await tx.$queryRaw`
          SELECT "id"
          FROM "Appointment"
          WHERE "id" = ${payment.appointmentId}
          FOR UPDATE
        `;
      }

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

      // Verify the current database identity again
      // under the transaction.

      if (
        currentPayment.provider !== PaymentProvider.STRIPE ||
        currentPayment.providerPaymentId !== paymentIntent.id ||
        currentPayment.currency.toLowerCase() !==
          paymentIntent.currency.toLowerCase() ||
        stripeAmount(currentPayment.amount, currentPayment.currency) !==
          paymentIntent.amount ||
        paymentIntent.amount_received !== paymentIntent.amount
      ) {
        throw new AppError("Stripe captured payment identity mismatch", 409);
      }

      // IMPORTANT:
      // Do not mark PAID before the appointment remaining
      // branch checks its previous state.
      //
      // Otherwise remaining payments may appear already
      // settled and skip the appointment update.

      let lateAppointmentPayment: LateAppointmentPayment | null = null;

      // CONTINUES IN PART 2

      // ===================================================
      // LATE CAPTURE / DUPLICATE PAYMENT REFUND HELPER
      // ===================================================

      const rejectAppointmentCapture = async () => {
        // Stripe has captured the money.
        // Preserve the financial record while the existing
        // reconciliation workflow handles the refund.

        await tx.payment.updateMany({
          where: {
            id: currentPayment.id,
            status: {
              in: [PaymentStatus.PENDING, PaymentStatus.FAILED],
            },
          },
          data: {
            status: PaymentStatus.PAID,
            paidAt: new Date(),
            failedAt: null,
          },
        });

        await getOrCreateLateGroupPurchaseRefund(
          currentPayment.id,
          currentPayment.amount,
          tx,
        );

        return {
          alreadyProcessed: false,
          lateAppointmentPayment: {
            paymentId: currentPayment.id,
            appointmentId: currentPayment.appointmentId!,
            customerId: currentPayment.customerId,
            amount: Number(currentPayment.amount),
            currency: currentPayment.currency,
            providerPaymentId: paymentIntent.id,
          },
        };
      };

      // ===================================================
      // APPOINTMENT PAYMENT IDENTITY
      // ===================================================

      if (currentPayment.appointmentId) {
        if (
          paymentIntent.metadata?.paymentId !== currentPayment.id ||
          paymentIntent.metadata?.appointmentId !==
            currentPayment.appointmentId ||
          paymentIntent.metadata?.customerId !== currentPayment.customerId ||
          paymentIntent.metadata?.purpose !== currentPayment.purpose
        ) {
          throw new AppError(
            "Invalid appointment Stripe payment identity",
            409,
          );
        }

        // Check whether this captured payment is already
        // being reconciled as a late payment.

        const pendingCapture = await tx.refund.findFirst({
          where: {
            paymentId: currentPayment.id,
            reason: "LATE_PAYMENT_AFTER_APPOINTMENT_EXPIRY",
          },
        });

        const settledStatuses: PaymentStatus[] = [
          PaymentStatus.PAID,
          PaymentStatus.PARTIALLY_REFUNDED,
          PaymentStatus.REFUNDED,
        ];

        const settled = settledStatuses.includes(currentPayment.status);

        if (pendingCapture || settled) {
          if (pendingCapture) {
            return rejectAppointmentCapture();
          }

          // Already settled. Do not mutate the appointment
          // or generate another notification.

          await tx.stripeWebhookEvent.create({
            data: {
              id: event.id,
              type: event.type,
            },
          });

          return {
            alreadyProcessed: true,
            lateAppointmentPayment: null as LateAppointmentPayment | null,
          };
        }

        // Prevent a second successful payment for the same
        // appointment and payment purpose.

        const other = await tx.payment.findFirst({
          where: {
            appointmentId: currentPayment.appointmentId,
            purpose: currentPayment.purpose,
            id: {
              not: currentPayment.id,
            },
            status: {
              in: [
                PaymentStatus.PAID,
                PaymentStatus.PARTIALLY_REFUNDED,
                PaymentStatus.REFUNDED,
              ],
            },
          },
        });

        if (other) {
          return rejectAppointmentCapture();
        }
      }

      // ===================================================
      // NORMAL APPOINTMENT PAYMENT
      // ===================================================

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
            price: true,
            depositAmount: true,
            remainingAmount: true,
            currency: true,
            groupPurchaseId: true,
          },
        });

        if (!appointment) {
          throw new AppError("Appointment not found", 404);
        }

        // =================================================
        // BLOCK GROUP PURCHASE-LINKED APPOINTMENTS
        // =================================================

        if (appointment.groupPurchaseId !== null) {
          throw new AppError(
            "Group Purchase-linked appointment cannot be settled through the normal appointment payment webhook",
            409,
          );
        }

        // =================================================
        // VERIFY APPOINTMENT FINANCIAL SNAPSHOT
        // =================================================

        if (appointment.currency !== currentPayment.currency) {
          throw new AppError(
            "Appointment and captured payment currency mismatch; reconciliation required",
            503,
          );
        }

        if (
          currentPayment.purpose === PaymentPurpose.APPOINTMENT &&
          !appointment.price.equals(currentPayment.amount)
        ) {
          throw new AppError(
            "Appointment full payment amount mismatch; reconciliation required",
            503,
          );
        }

        if (
          currentPayment.purpose === PaymentPurpose.APPOINTMENT_DEPOSIT &&
          (!appointment.depositAmount ||
            !appointment.depositAmount.equals(currentPayment.amount))
        ) {
          throw new AppError(
            "Appointment deposit amount mismatch; reconciliation required",
            503,
          );
        }

        // =================================================
        // NORMAL DEPOSIT - STRIPE REMAINING PAYMENT
        // =================================================

        if (currentPayment.purpose === PaymentPurpose.APPOINTMENT_REMAINING) {
          // ---------------------------------------------
          // 1. VALIDATE REMAINING PAYMENT IDENTITY
          // ---------------------------------------------

          if (
            currentPayment.provider !== PaymentProvider.STRIPE ||
            currentPayment.customerId !== appointment.customerId ||
            appointment.bookingMethod !== BookingMethod.DEPOSIT ||
            paymentIntent.metadata?.paymentId !== currentPayment.id ||
            paymentIntent.metadata?.appointmentId !== appointment.id ||
            paymentIntent.metadata?.customerId !== appointment.customerId ||
            paymentIntent.metadata?.purpose !==
              PaymentPurpose.APPOINTMENT_REMAINING
          ) {
            throw new AppError(
              "Invalid appointment remaining payment identity",
              409,
            );
          }

          // ---------------------------------------------
          // 2. DUPLICATE SETTLEMENT PROTECTION
          // ---------------------------------------------

          if (
            currentPayment.status === PaymentStatus.PAID ||
            currentPayment.status === PaymentStatus.PARTIALLY_REFUNDED ||
            currentPayment.status === PaymentStatus.REFUNDED
          ) {
            await tx.stripeWebhookEvent.create({
              data: {
                id: event.id,
                type: event.type,
              },
            });

            return {
              alreadyProcessed: true,
              lateAppointmentPayment: null as LateAppointmentPayment | null,
            };
          }

          // ---------------------------------------------
          // 3. LOCK APPOINTMENT
          // ---------------------------------------------

          await tx.$queryRaw`
            SELECT "id"
            FROM "Appointment"
            WHERE "id" = ${appointment.id}
            FOR UPDATE
          `;

          const latestAppointment = await tx.appointment.findUnique({
            where: {
              id: appointment.id,
            },
            select: {
              id: true,
              customerId: true,
              groupPurchaseId: true,
              bookingMethod: true,
              appointmentStatus: true,
              paymentStatus: true,
              qrVerifiedAt: true,
              price: true,
              depositAmount: true,
              remainingAmount: true,
              currency: true,
            },
          });

          if (!latestAppointment) {
            throw new AppError("Appointment not found", 404);
          }

          // ---------------------------------------------
          // 4. VERIFY REMAINING AMOUNT
          // ---------------------------------------------

          const expectedRemaining = latestAppointment.price.minus(
            latestAppointment.depositAmount ?? new Prisma.Decimal(0),
          );

          if (
            !latestAppointment.depositAmount ||
            latestAppointment.depositAmount.lte(0) ||
            expectedRemaining.lte(0) ||
            !expectedRemaining.equals(currentPayment.amount) ||
            (latestAppointment.remainingAmount !== null &&
              !latestAppointment.remainingAmount.equals(expectedRemaining)) ||
            latestAppointment.currency !== currentPayment.currency
          ) {
            return rejectAppointmentCapture();
          }

          // ---------------------------------------------
          // 5. VERIFY ORIGINAL DEPOSIT PAYMENT
          // ---------------------------------------------

          const originalDeposit = await tx.payment.findFirst({
            where: {
              appointmentId: appointment.id,
              purpose: PaymentPurpose.APPOINTMENT_DEPOSIT,
              status: {
                in: [PaymentStatus.PAID, PaymentStatus.PARTIALLY_REFUNDED],
              },
            },
            orderBy: {
              createdAt: "desc",
            },
          });

          if (
            !originalDeposit ||
            originalDeposit.customerId !== currentPayment.customerId ||
            originalDeposit.currency !== currentPayment.currency ||
            !originalDeposit.amount.equals(latestAppointment.depositAmount)
          ) {
            throw new AppError(
              "Original appointment deposit mismatch; reconciliation required",
              503,
            );
          }

          // ---------------------------------------------
          // 6. CHECK OTHER SETTLED REMAINING PAYMENT
          // ---------------------------------------------

          const otherSettledPayment = await tx.payment.findFirst({
            where: {
              appointmentId: appointment.id,
              purpose: PaymentPurpose.APPOINTMENT_REMAINING,
              id: {
                not: currentPayment.id,
              },
              status: {
                in: [PaymentStatus.PAID, PaymentStatus.PARTIALLY_REFUNDED],
              },
            },
            select: {
              id: true,
            },
          });

          // ---------------------------------------------
          // 7. VERIFY APPOINTMENT ELIGIBILITY
          // ---------------------------------------------

          const eligible =
            latestAppointment.customerId === currentPayment.customerId &&
            latestAppointment.groupPurchaseId === null &&
            latestAppointment.bookingMethod === BookingMethod.DEPOSIT &&
            latestAppointment.appointmentStatus ===
              AppointmentStatus.CONFIRMED &&
            latestAppointment.paymentStatus === PaymentStatus.PARTIALLY_PAID &&
            latestAppointment.qrVerifiedAt !== null &&
            otherSettledPayment === null;

          if (!eligible) {
            // Funds were captured but the appointment
            // is no longer eligible for settlement.

            return rejectAppointmentCapture();
          }

          // ---------------------------------------------
          // 8. GUARDED APPOINTMENT SETTLEMENT
          // ---------------------------------------------

          const updatedAppointment = await tx.appointment.updateMany({
            where: {
              id: appointment.id,
              customerId: currentPayment.customerId,
              groupPurchaseId: null,
              bookingMethod: BookingMethod.DEPOSIT,
              appointmentStatus: AppointmentStatus.CONFIRMED,
              paymentStatus: PaymentStatus.PARTIALLY_PAID,
              qrVerifiedAt: {
                not: null,
              },
            },
            data: {
              paymentStatus: PaymentStatus.PAID,
            },
          });

          if (updatedAppointment.count !== 1) {
            throw new AppError(
              "Appointment remaining payment settlement conflict",
              409,
            );
          }

          // ---------------------------------------------
          // 9. CUSTOMER NOTIFICATION
          // ---------------------------------------------

          const translations = notificationTemplates.REMAINING_PAYMENT_RECEIVED(
            Number(currentPayment.amount),
            currentPayment.currency,
          );

          await notificationService.createNotification(
            {
              appointmentId: appointment.id,
              userId: appointment.customerId,
              type: "REMAINING_PAYMENT_RECEIVED",
              title: translations.en!.title!,
              message: translations.en!.message!,
              translations,
            },
            tx,
          );

          // ---------------------------------------------
          // 10. AUDIT LOG
          // ---------------------------------------------

          await auditLogService.createAuditLog(
            {
              userId: null,
              action: "APPOINTMENT_REMAINING_PAYMENT_RECEIVED",
              entityType: "APPOINTMENT",
              entityId: appointment.id,
              metadata: {
                paymentId: currentPayment.id,
                provider: PaymentProvider.STRIPE,
                providerPaymentId: paymentIntent.id,
                amount: Number(currentPayment.amount),
                currency: currentPayment.currency,
              },
            },
            tx,
          );
        }

        // CONTINUES IN PART 3

        // =====================================================
        // PAY NOW PAYMENT
        // =====================================================

        const now = new Date();

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

          // ---------------------------------------------------
          // NORMAL PAY NOW SUCCESS
          // ---------------------------------------------------

          if (holdIsStillActive) {
            const qrToken =
              appointment.qrToken ?? crypto.randomBytes(32).toString("hex");

            await tx.appointment.update({
              where: {
                id: appointment.id,
              },
              data: {
                appointmentStatus: AppointmentStatus.CONFIRMED,
                paymentStatus: PaymentStatus.PAID,
                holdExpiresAt: null,
                emailPaymentConfirmedAt: now,
                qrToken,
                qrVerifiedAt: null,
                qrVerifiedBy: null,
              },
            });

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

          // ---------------------------------------------------
          // ALREADY CONFIRMED
          // ---------------------------------------------------
          else if (
            appointment.appointmentStatus === AppointmentStatus.CONFIRMED &&
            appointment.paymentStatus === PaymentStatus.PAID
          ) {
            // Already settled. No duplicate notification.
          }

          // ---------------------------------------------------
          // LATE PAY NOW PAYMENT
          // ---------------------------------------------------
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
                holdExpiresAt: null,
              },
            });

            return rejectAppointmentCapture();
          }
        }

        // =====================================================
        // INITIAL DEPOSIT PAYMENT
        // =====================================================

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

          // ---------------------------------------------------
          // NORMAL DEPOSIT SUCCESS
          // ---------------------------------------------------

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
                emailPaymentConfirmedAt: now,
                qrToken,
                qrVerifiedAt: null,
                qrVerifiedBy: null,
              },
            });

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

          // ---------------------------------------------------
          // ALREADY RESERVED / CONFIRMED
          // ---------------------------------------------------
          else if (
            (appointment.appointmentStatus === AppointmentStatus.RESERVED ||
              appointment.appointmentStatus === AppointmentStatus.CONFIRMED) &&
            appointment.paymentStatus === PaymentStatus.PARTIALLY_PAID
          ) {
            // Already settled. No duplicate notification.
          }

          // ---------------------------------------------------
          // LATE DEPOSIT PAYMENT
          // ---------------------------------------------------
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
                holdExpiresAt: null,
              },
            });

            return rejectAppointmentCapture();
          }
        }
      }

      // =====================================================
      // PAYMENT -> PAID
      // =====================================================

      // Update the local payment after the appointment
      // settlement checks, not before them.

      await tx.payment.updateMany({
        where: {
          id: currentPayment.id,
          provider: PaymentProvider.STRIPE,
          providerPaymentId: paymentIntent.id,
          status: {
            in: [PaymentStatus.PENDING, PaymentStatus.FAILED],
          },
        },
        data: {
          status: PaymentStatus.PAID,
          paidAt: new Date(),
          failedAt: null,
        },
      });

      // =====================================================
      // WALLET TOP-UP PAYMENT
      // =====================================================

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
          const wallet = await tx.wallet.findUniqueOrThrow({
            where: {
              id: topup.walletId,
            },
          });

          assertSameCurrency(wallet.currency, currentPayment.currency);

          assertCurrencyAmount(topup.amount, currentPayment.currency);

          assertCurrencyAmount(topup.potentialBonus, currentPayment.currency);

          // ---------------------------------------------------
          // CREDIT WALLET PAID BALANCE + BONUS
          // ---------------------------------------------------

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

          // ---------------------------------------------------
          // TOP-UP TRANSACTION
          // ---------------------------------------------------

          await tx.walletTransaction.create({
            data: {
              walletId: topup.walletId,
              type: WalletTransactionType.TOP_UP,
              balanceType: BalanceType.PAID,
              amount: topup.amount,
              referenceId: topup.id,
            },
          });

          // ---------------------------------------------------
          // BONUS TRANSACTION
          // ---------------------------------------------------

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

          // ---------------------------------------------------
          // WALLET TOP-UP -> PAID
          // ---------------------------------------------------

          await tx.walletTopup.update({
            where: {
              id: topup.id,
            },
            data: {
              status: WalletTopupStatus.PAID,
              paidAt: new Date(),
            },
          });

          // ---------------------------------------------------
          // CUSTOMER NOTIFICATION
          // ---------------------------------------------------

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

      // =====================================================
      // MARK WEBHOOK PROCESSED
      // =====================================================

      await tx.stripeWebhookEvent.create({
        data: {
          id: event.id,
          type: event.type,
        },
      });

      return {
        alreadyProcessed: false,
        lateAppointmentPayment,
      };
    });

    // =====================================================
    // TRANSACTION ALREADY PROCESSED
    // =====================================================

    if (transactionResult.alreadyProcessed) {
      return {
        received: true as const,
      };
    }

    // =====================================================
    // LATE PAYMENT REFUND RECONCILIATION
    // =====================================================

    const latePayment = transactionResult.lateAppointmentPayment;

    if (latePayment) {
      return reconcileUnappliedCapture(latePayment.paymentId, event);
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

    if (!payment) {
      // Do not permanently acknowledge a payment event
      // before its local payment record can be resolved.
      throw new AppError(
        "Stripe failed payment record not found; retry required",
        503,
      );
    }

    await prisma.$transaction(async (tx) => {
      const existingEvent = await tx.stripeWebhookEvent.findUnique({
        where: {
          id: event.id,
        },
      });

      if (existingEvent) {
        return;
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
        currentPayment.provider !== PaymentProvider.STRIPE ||
        currentPayment.providerPaymentId !== paymentIntent.id
      ) {
        throw new AppError("Stripe failed payment identity mismatch", 409);
      }

      // ===================================================
      // PAYMENT -> FAILED
      // ===================================================

      // A failed Stripe payment attempt must never
      // overwrite an already successful local payment.

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

        if (changed.count === 1 && currentPayment.appointmentId) {
          const translations = notificationTemplates.PAYMENT_FAILED();

          await notificationService.createNotification(
            {
              appointmentId: currentPayment.appointmentId,
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

      // ===================================================
      // WALLET TOP-UP -> FAILED
      // ===================================================

      if (currentPayment.walletTopupId) {
        const topup = await tx.walletTopup.findUnique({
          where: {
            id: currentPayment.walletTopupId,
          },
        });

        if (
          topup &&
          topup.status === WalletTopupStatus.PENDING &&
          currentPayment.status !== PaymentStatus.PAID
        ) {
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

      // ===================================================
      // MARK EVENT PROCESSED
      // ===================================================

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
      currency: true,
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

  const isBookNow = purchase.purchaseFlow === GroupPurchaseFlow.DIRECT_BOOK;

  if (
    purchase.purchaseFlow !== GroupPurchaseFlow.BUY_NOW_BOOK_LATER &&
    purchase.purchaseFlow !== GroupPurchaseFlow.DIRECT_BOOK
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
  // 4. DETERMINE PAYMENT AMOUNT AND CURRENCY
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

    // Deposit is calculated on the full purchase amount.
    paymentAmount = purchase.depositAmount;
  }

  // Resolve the historical purchase currency.
  // Never substitute the current Brand currency.
  const currency = await getPurchaseCurrency(prisma, purchaseId);

  // If the purchase has a stored currency snapshot,
  // it must match the reconciled currency.
  if (purchase.currency !== null && purchase.currency !== currency) {
    throw new AppError("Group purchase currency snapshot mismatch", 409);
  }

  const amountInCents = stripeAmount(paymentAmount, currency);

  // Preserve the existing minimum-amount policy.
  // A currency-specific Stripe minimum policy should
  // be introduced separately before wider rollout.
  if (
    !Number.isSafeInteger(amountInCents) ||
    amountInCents < (currency === "HKD" ? 400 : 1)
  ) {
    throw new AppError("Invalid Stripe payment amount", 422);
  }

  // =====================================================
  // 5. FIND OR CREATE LOCAL PAYMENT ATTEMPT
  // =====================================================

  // Serialize local payment identity.
  // Concurrent requests reuse the same payment and
  // Stripe idempotency key.

  let payment: Prisma.PaymentGetPayload<{}> | undefined;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      payment = await prisma.$transaction(
        async (tx) => {
          // Lock the purchase before validating its state.
          await tx.$queryRaw`
            SELECT "id"
            FROM "GroupPurchase"
            WHERE "id" = ${purchaseId}
            FOR UPDATE
          `;

          const current = await tx.groupPurchase.findUnique({
            where: { id: purchaseId },
          });

          if (
            !current ||
            current.customerId !== customerId ||
            current.paymentStatus !== PaymentStatus.PENDING ||
            !current.reservationExpiresAt ||
            current.reservationExpiresAt <= new Date()
          ) {
            throw new AppError("Group purchase is no longer payable", 409);
          }

          // Verify that the purchase flow has not changed.
          if (
            current.purchaseFlow !== purchase.purchaseFlow ||
            current.bookingMethod !== purchase.bookingMethod
          ) {
            throw new AppError(
              "Group purchase booking configuration changed",
              409,
            );
          }

          // Verify the full purchase amount and deposit.
          if (
            !current.amount.equals(purchase.amount) ||
            (current.depositAmount === null
              ? purchase.depositAmount !== null
              : purchase.depositAmount === null ||
                !current.depositAmount.equals(purchase.depositAmount))
          ) {
            throw new AppError("Group purchase amount changed", 409);
          }

          // Reconcile currency inside the transaction.
          const currentCurrency = await getPurchaseCurrency(tx, purchaseId);

          if (
            currentCurrency !== currency ||
            (current.currency !== null && current.currency !== currentCurrency)
          ) {
            throw new AppError("Group purchase currency changed", 409);
          }

          // Revalidate the amount in its transaction currency.
          assertCurrencyAmount(paymentAmount, currentCurrency);

          // =================================================
          // REUSE EXISTING PENDING STRIPE PAYMENT
          // =================================================

          const pending = await tx.payment.findFirst({
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

          if (pending) {
            if (
              !pending.amount.equals(paymentAmount) ||
              pending.currency !== currentCurrency
            ) {
              throw new AppError(
                "Existing payment amount or currency does not match purchase",
                409,
              );
            }

            return pending;
          }

          // =================================================
          // CREATE NEW PAYMENT ATTEMPT
          // =================================================

          return tx.payment.create({
            data: {
              customerId,
              groupPurchaseId: purchaseId,
              purpose: PaymentPurpose.GROUP_PURCHASE,
              provider: PaymentProvider.STRIPE,
              amount: paymentAmount,
              currency: currentCurrency,
              status: PaymentStatus.PENDING,
            },
          });
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        },
      );

      break;
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

  if (!payment) {
    throw new AppError("Group purchase payment conflict", 409);
  }

  // =====================================================
  // 6. VERIFY LOCAL PAYMENT CURRENCY AND AMOUNT
  // =====================================================

  if (payment.currency !== currency || !payment.amount.equals(paymentAmount)) {
    throw new AppError("Group purchase payment snapshot mismatch", 409);
  }

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
          currency: currency.toLowerCase(),

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

      // Save Stripe PaymentIntent identity.
      // Conditional update avoids replacing a different
      // provider intent created by a concurrent request.

      const updated = await prisma.payment.updateMany({
        where: {
          id: payment.id,
          status: PaymentStatus.PENDING,
          provider: PaymentProvider.STRIPE,
          providerPaymentId: null,
        },
        data: {
          providerPaymentId: paymentIntent.id,
        },
      });

      if (updated.count !== 1) {
        const latestPayment = await prisma.payment.findUnique({
          where: {
            id: payment.id,
          },
        });

        if (
          !latestPayment ||
          latestPayment.providerPaymentId !== paymentIntent.id
        ) {
          throw new AppError("Stripe payment identity conflict", 409);
        }
      }
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
      paymentIntent.metadata?.purpose !== PaymentPurpose.GROUP_PURCHASE ||
      paymentIntent.metadata?.purchaseFlow !== purchase.purchaseFlow ||
      paymentIntent.metadata?.bookingMethod !==
        (purchase.bookingMethod ?? "NONE")
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
      where: {
        id: purchaseId,
      },
      select: {
        customerId: true,
        currency: true,
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
      currentPurchase.customerId !== customerId ||
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
      currentPurchase.purchaseFlow === GroupPurchaseFlow.DIRECT_BOOK &&
      currentPurchase.bookingMethod === BookingMethod.DEPOSIT
        ? currentPurchase.depositAmount
        : currentPurchase.amount;

    if (
      !currentExpectedAmount ||
      !currentExpectedAmount.equals(paymentAmount)
    ) {
      throw new AppError("Group purchase payable amount changed", 409);
    }

    // Ensure the original currency snapshot is unchanged.
    if (
      currentPurchase.currency !== null &&
      currentPurchase.currency !== currency
    ) {
      throw new AppError("Group purchase currency changed", 409);
    }

    const latestCurrency = await getPurchaseCurrency(prisma, purchaseId);

    if (latestCurrency !== payment.currency) {
      throw new AppError("Group purchase payment currency mismatch", 409);
    }

    // Recheck the payment after Stripe's network call.
    const latestPayment = await prisma.payment.findUnique({
      where: {
        id: payment.id,
      },
      select: {
        customerId: true,
        groupPurchaseId: true,
        purpose: true,
        provider: true,
        amount: true,
        currency: true,
        status: true,
        providerPaymentId: true,
      },
    });

    if (
      !latestPayment ||
      latestPayment.customerId !== customerId ||
      latestPayment.groupPurchaseId !== purchaseId ||
      latestPayment.purpose !== PaymentPurpose.GROUP_PURCHASE ||
      latestPayment.provider !== PaymentProvider.STRIPE ||
      latestPayment.status !== PaymentStatus.PENDING ||
      !latestPayment.amount.equals(paymentAmount) ||
      latestPayment.currency !== currency ||
      latestPayment.providerPaymentId !== paymentIntent.id
    ) {
      throw new AppError("Group purchase payment is no longer payable", 409);
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

const createGroupPurchaseRemainingStripeIntent = async (
  customerId: string,
  purchaseId: string,
) => {
  // =====================================================
  // 1. FIND GROUP PURCHASE
  // =====================================================

  const purchase = await prisma.groupPurchase.findUnique({
    where: { id: purchaseId },
    include: {
      appointments: {
        select: {
          id: true,
          customerId: true,
          bookingMethod: true,
          appointmentStatus: true,
          paymentStatus: true,
          qrVerifiedAt: true,
          currency: true,
        },
      },
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
  // 2. DIRECT BOOK + DEPOSIT ONLY
  // =====================================================

  if (
    purchase.purchaseFlow !== GroupPurchaseFlow.DIRECT_BOOK ||
    purchase.bookingMethod !== BookingMethod.DEPOSIT
  ) {
    throw new AppError(
      "Remaining payment is only available for Direct Book deposit purchases",
      409,
    );
  }

  if (purchase.paymentStatus !== PaymentStatus.PARTIALLY_PAID) {
    throw new AppError("Group purchase is not awaiting remaining payment", 409);
  }

  // =====================================================
  // 3. VERIFY INITIAL APPOINTMENT
  // =====================================================

  if (purchase.appointments.length !== 1) {
    throw new AppError("Invalid Direct Book appointment state", 409);
  }

  const appointment = purchase.appointments[0];

  if (
    appointment.customerId !== customerId ||
    appointment.bookingMethod !== BookingMethod.DEPOSIT ||
    appointment.appointmentStatus !== AppointmentStatus.CONFIRMED ||
    appointment.paymentStatus !== PaymentStatus.PARTIALLY_PAID ||
    !appointment.qrVerifiedAt
  ) {
    throw new AppError(
      "Appointment must be QR verified before remaining payment",
      409,
    );
  }

  // =====================================================
  // 4. CALCULATE REMAINING ON FULL PURCHASE AMOUNT
  // =====================================================

  if (
    !purchase.depositAmount ||
    purchase.depositAmount.lte(0) ||
    purchase.depositAmount.gte(purchase.amount)
  ) {
    throw new AppError("Invalid group purchase deposit", 409);
  }

  const remainingAmount = purchase.amount.minus(purchase.depositAmount);

  // Resolve currency from original historical purchase.
  const currency = await getPurchaseCurrency(prisma, purchaseId);

  if (
    (purchase.currency !== null && purchase.currency !== currency) ||
    appointment.currency !== currency
  ) {
    throw new AppError("Group purchase or appointment currency mismatch", 409);
  }

  assertCurrencyAmount(purchase.amount, currency);
  assertCurrencyAmount(purchase.depositAmount, currency);
  assertCurrencyAmount(remainingAmount, currency);

  const amountInCents = stripeAmount(remainingAmount, currency);

  // Preserve existing Stripe minimum policy.
  if (
    !Number.isSafeInteger(amountInCents) ||
    amountInCents < (currency === "HKD" ? 400 : 1)
  ) {
    throw new AppError(
      "Remaining amount is below the supported Stripe minimum",
      422,
    );
  }

  // =====================================================
  // 5. CREATE OR REUSE PAYMENT ATTEMPT
  // =====================================================

  let payment: Prisma.PaymentGetPayload<{}> | undefined;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      payment = await prisma.$transaction(
        async (tx) => {
          // Serialize remaining-payment creation.
          await tx.$queryRaw`
            SELECT "id"
            FROM "GroupPurchase"
            WHERE "id" = ${purchaseId}
            FOR UPDATE
          `;

          const current = await tx.groupPurchase.findUnique({
            where: { id: purchaseId },
            include: {
              appointments: {
                select: {
                  id: true,
                  customerId: true,
                  bookingMethod: true,
                  appointmentStatus: true,
                  paymentStatus: true,
                  qrVerifiedAt: true,
                  currency: true,
                },
              },
            },
          });

          if (
            !current ||
            current.customerId !== customerId ||
            current.purchaseFlow !== GroupPurchaseFlow.DIRECT_BOOK ||
            current.bookingMethod !== BookingMethod.DEPOSIT ||
            current.paymentStatus !== PaymentStatus.PARTIALLY_PAID ||
            !current.depositAmount ||
            !current.amount.minus(current.depositAmount).equals(remainingAmount)
          ) {
            throw new AppError(
              "Group purchase is no longer eligible for remaining payment",
              409,
            );
          }

          // =================================================
          // VERIFY PURCHASE CURRENCY INSIDE TRANSACTION
          // =================================================

          const currentCurrency = await getPurchaseCurrency(tx, purchaseId);

          if (
            currentCurrency !== currency ||
            (current.currency !== null && current.currency !== currentCurrency)
          ) {
            throw new AppError("Group purchase currency changed", 409);
          }

          if (
            current.appointments.length !== 1 ||
            current.appointments[0].id !== appointment.id ||
            current.appointments[0].customerId !== customerId ||
            current.appointments[0].bookingMethod !== BookingMethod.DEPOSIT ||
            current.appointments[0].appointmentStatus !==
              AppointmentStatus.CONFIRMED ||
            current.appointments[0].paymentStatus !==
              PaymentStatus.PARTIALLY_PAID ||
            !current.appointments[0].qrVerifiedAt ||
            current.appointments[0].currency !== currentCurrency
          ) {
            throw new AppError(
              "Group purchase appointment is no longer eligible",
              409,
            );
          }

          // =================================================
          // VERIFY INITIAL DEPOSIT PAYMENT
          // =================================================

          const initialPayment = await tx.payment.findUnique({
            where: {
              id: current.settledPaymentId ?? "",
            },
          });

          if (
            !initialPayment ||
            initialPayment.groupPurchaseId !== purchaseId ||
            initialPayment.customerId !== customerId ||
            initialPayment.purpose !== PaymentPurpose.GROUP_PURCHASE ||
            initialPayment.status !== PaymentStatus.PAID ||
            !initialPayment.amount.equals(current.depositAmount) ||
            initialPayment.currency !== currentCurrency
          ) {
            throw new AppError(
              "Paid group purchase deposit could not be verified",
              409,
            );
          }

          // =================================================
          // PREVENT DUPLICATE SETTLEMENT
          // =================================================

          const settledRemaining = await tx.payment.findFirst({
            where: {
              groupPurchaseId: purchaseId,
              purpose: PaymentPurpose.GROUP_PURCHASE,
              id: {
                not: initialPayment.id,
              },
              status: {
                in: [PaymentStatus.PAID, PaymentStatus.PARTIALLY_REFUNDED],
              },
            },
          });

          if (settledRemaining) {
            throw new AppError(
              "Group purchase remaining payment already completed",
              409,
            );
          }

          // =================================================
          // REUSE PENDING STRIPE PAYMENT
          // =================================================

          const pending = await tx.payment.findFirst({
            where: {
              groupPurchaseId: purchaseId,
              purpose: PaymentPurpose.GROUP_PURCHASE,
              provider: PaymentProvider.STRIPE,
              status: PaymentStatus.PENDING,
            },
            orderBy: {
              createdAt: "asc",
            },
          });

          if (pending) {
            if (
              pending.id === initialPayment.id ||
              pending.customerId !== customerId ||
              !pending.amount.equals(remainingAmount) ||
              pending.currency !== currentCurrency
            ) {
              throw new AppError(
                "Existing group remaining payment attempt does not match",
                409,
              );
            }

            return pending;
          }

          // =================================================
          // BLOCK OTHER PENDING PAYMENT PROVIDERS
          // =================================================

          const otherPending = await tx.payment.findFirst({
            where: {
              groupPurchaseId: purchaseId,
              purpose: PaymentPurpose.GROUP_PURCHASE,
              status: PaymentStatus.PENDING,
            },
          });

          if (otherPending) {
            throw new AppError(
              "Another group purchase payment is pending",
              409,
            );
          }

          // =================================================
          // CREATE REMAINING PAYMENT
          // =================================================

          return tx.payment.create({
            data: {
              customerId,
              groupPurchaseId: purchaseId,
              purpose: PaymentPurpose.GROUP_PURCHASE,
              provider: PaymentProvider.STRIPE,
              amount: remainingAmount,
              currency: currentCurrency,
              status: PaymentStatus.PENDING,
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

  if (!payment) {
    throw new AppError("Group purchase remaining payment conflict", 409);
  }

  // =====================================================
  // 6. VERIFY LOCAL PAYMENT SNAPSHOT
  // =====================================================

  if (
    payment.currency !== currency ||
    !payment.amount.equals(remainingAmount)
  ) {
    throw new AppError(
      "Group purchase remaining payment currency or amount mismatch",
      409,
    );
  }

  // =====================================================
  // 7. CREATE OR REUSE STRIPE PAYMENT INTENT
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
          currency: currency.toLowerCase(),

          metadata: {
            paymentId: payment.id,
            groupPurchaseId: purchaseId,
            appointmentId: appointment.id,
            customerId,
            purpose: PaymentPurpose.GROUP_PURCHASE,
            paymentStage: "REMAINING",
            bookingMethod: BookingMethod.DEPOSIT,
            purchaseFlow: GroupPurchaseFlow.DIRECT_BOOK,
          },

          automatic_payment_methods: {
            enabled: true,
            allow_redirects: "never",
          },
        },
        {
          idempotencyKey: `group-purchase-remaining-intent-${payment.id}`,
        },
      );

      // Save Stripe identity conditionally.
      const updated = await prisma.payment.updateMany({
        where: {
          id: payment.id,
          status: PaymentStatus.PENDING,
          provider: PaymentProvider.STRIPE,
          providerPaymentId: null,
        },
        data: {
          providerPaymentId: paymentIntent.id,
        },
      });

      if (updated.count !== 1) {
        const latest = await prisma.payment.findUnique({
          where: {
            id: payment.id,
          },
        });

        if (!latest || latest.providerPaymentId !== paymentIntent.id) {
          throw new AppError("Stripe remaining payment identity conflict", 409);
        }
      }
    }

    // =====================================================
    // 8. VERIFY STRIPE PAYMENT INTENT
    // =====================================================

    if (
      paymentIntent.amount !== amountInCents ||
      paymentIntent.currency.toLowerCase() !== payment.currency.toLowerCase() ||
      paymentIntent.metadata?.paymentId !== payment.id ||
      paymentIntent.metadata?.groupPurchaseId !== purchaseId ||
      paymentIntent.metadata?.appointmentId !== appointment.id ||
      paymentIntent.metadata?.customerId !== customerId ||
      paymentIntent.metadata?.purpose !== PaymentPurpose.GROUP_PURCHASE ||
      paymentIntent.metadata?.paymentStage !== "REMAINING" ||
      paymentIntent.metadata?.bookingMethod !== BookingMethod.DEPOSIT ||
      paymentIntent.metadata?.purchaseFlow !== GroupPurchaseFlow.DIRECT_BOOK
    ) {
      throw new AppError("Stripe remaining PaymentIntent mismatch", 409);
    }

    if (
      !paymentIntent.client_secret ||
      ![
        "requires_payment_method",
        "requires_confirmation",
        "requires_action",
      ].includes(paymentIntent.status)
    ) {
      throw new AppError("Stripe remaining PaymentIntent is not payable", 409);
    }

    // =====================================================
    // 9. RECHECK PURCHASE AFTER STRIPE NETWORK CALL
    // =====================================================

    const latestPurchase = await prisma.groupPurchase.findUnique({
      where: {
        id: purchaseId,
      },
      select: {
        customerId: true,
        currency: true,
        purchaseFlow: true,
        bookingMethod: true,
        paymentStatus: true,
        amount: true,
        depositAmount: true,
        settledPaymentId: true,
      },
    });

    if (
      !latestPurchase ||
      latestPurchase.customerId !== customerId ||
      latestPurchase.purchaseFlow !== GroupPurchaseFlow.DIRECT_BOOK ||
      latestPurchase.bookingMethod !== BookingMethod.DEPOSIT ||
      latestPurchase.paymentStatus !== PaymentStatus.PARTIALLY_PAID ||
      !latestPurchase.depositAmount ||
      !latestPurchase.amount
        .minus(latestPurchase.depositAmount)
        .equals(remainingAmount) ||
      latestPurchase.settledPaymentId !== purchase.settledPaymentId ||
      (latestPurchase.currency !== null && latestPurchase.currency !== currency)
    ) {
      throw new AppError(
        "Group purchase is no longer eligible for remaining payment",
        409,
      );
    }

    const latestCurrency = await getPurchaseCurrency(prisma, purchaseId);

    if (latestCurrency !== currency) {
      throw new AppError("Group purchase currency mismatch", 409);
    }

    // Verify the payment still points to this Stripe intent.
    const latestPayment = await prisma.payment.findUnique({
      where: {
        id: payment.id,
      },
      select: {
        customerId: true,
        groupPurchaseId: true,
        purpose: true,
        provider: true,
        amount: true,
        currency: true,
        status: true,
        providerPaymentId: true,
      },
    });

    if (
      !latestPayment ||
      latestPayment.customerId !== customerId ||
      latestPayment.groupPurchaseId !== purchaseId ||
      latestPayment.purpose !== PaymentPurpose.GROUP_PURCHASE ||
      latestPayment.provider !== PaymentProvider.STRIPE ||
      latestPayment.status !== PaymentStatus.PENDING ||
      !latestPayment.amount.equals(remainingAmount) ||
      latestPayment.currency !== currency ||
      latestPayment.providerPaymentId !== paymentIntent.id
    ) {
      throw new AppError(
        "Group purchase remaining payment is no longer payable",
        409,
      );
    }

    // =====================================================
    // 10. RESPONSE
    // =====================================================

    return {
      paymentId: payment.id,
      purchaseId,
      appointmentId: appointment.id,
      amount: Number(payment.amount),
      currency: payment.currency,
      paymentStatus: "PENDING" as const,
      clientSecret: paymentIntent.client_secret,
    };
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    logUnexpectedError(error, {
      source: "payment.service.ts:createGroupPurchaseRemainingStripeIntent",
    });

    throw new AppError(
      "Unable to create Group Purchase remaining Stripe PaymentIntent",
      502,
    );
  }
};

async function handleGroupPurchaseStripeEvent(
  event: Stripe.Event,
  paymentIntent: Stripe.PaymentIntent,
) {
  // =====================================================
  // 1. FIND AND VERIFY STRIPE PAYMENT
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

  const expectedCents = stripeAmount(payment.amount, payment.currency);

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
  // 2. HANDLE PAYMENT FAILURE
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

  if (
    ![
      "payment_intent.succeeded",
      "refund.created",
      "refund.updated",
      "refund.failed",
    ].includes(event.type)
  ) {
    return { received: true as const };
  }

  if (
    paymentIntent.status !== "succeeded" ||
    paymentIntent.amount_received !== expectedCents
  ) {
    throw new AppError("Stripe payment was not successful", 409);
  }

  // =====================================================
  // 3. SETTLEMENT
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
            where: {
              id: payment.groupPurchaseId!,
            },
            include: {
              appointments: {
                select: {
                  id: true,
                  bookingMethod: true,
                  appointmentStatus: true,
                  paymentStatus: true,
                  currency: true,
                },
              },
            },
          });

          if (!currentPayment || !purchase) {
            throw new AppError("Payment or purchase not found", 404);
          }

          // =================================================
          // 3.1 VERIFY PAYMENT IDENTITY
          // =================================================

          if (
            currentPayment.provider !== PaymentProvider.STRIPE ||
            currentPayment.purpose !== PaymentPurpose.GROUP_PURCHASE ||
            currentPayment.groupPurchaseId !== purchase.id ||
            currentPayment.providerPaymentId !== paymentIntent.id ||
            !currentPayment.amount.equals(payment.amount) ||
            currentPayment.customerId !== payment.customerId ||
            currentPayment.currency !== payment.currency
          ) {
            throw new AppError("Group purchase payment identity mismatch", 409);
          }

          // =================================================
          // 3.2 VERIFY ORIGINAL PURCHASE CURRENCY
          // =================================================

          // Resolve historical currency using the original
          // purchase, payment and appointment snapshots.
          // Never substitute the current Brand currency.

          const purchaseCurrency = await getPurchaseCurrency(tx, purchase.id);

          if (
            currentPayment.currency !== purchaseCurrency ||
            payment.currency !== purchaseCurrency ||
            (purchase.currency !== null &&
              purchase.currency !== purchaseCurrency) ||
            purchase.appointments.some(
              (item) => item.currency !== purchaseCurrency,
            )
          ) {
            throw new AppError(
              "Group purchase settlement currency requires reconciliation",
              409,
            );
          }

          // =================================================
          // 3.3 VALIDATE BOOKING METHOD AND AMOUNT
          // =================================================

          const isBookNow =
            purchase.purchaseFlow === GroupPurchaseFlow.DIRECT_BOOK;

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

          const initialAppointments = purchase.appointments.filter(
            (item) => item.bookingMethod === purchase.bookingMethod,
          );

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

          // =================================================
          // 4. DUPLICATE SETTLEMENT PROTECTION
          // =================================================

          // A duplicate payment must never change which
          // payment originally settled this purchase.

          if (
            purchase.purchasedAt &&
            [
              PaymentStatus.PAID,
              PaymentStatus.PARTIALLY_PAID,
              PaymentStatus.REFUNDED,
              PaymentStatus.PARTIALLY_REFUNDED,
            ].some((status) => status === purchase.paymentStatus)
          ) {
            if (!purchase.settledPaymentId) {
              throw new AppError(
                "Legacy group settlement identity requires manual reconciliation",
                503,
              );
            }

            if (purchase.settledPaymentId === currentPayment.id) {
              if (
                ![
                  PaymentStatus.PAID,
                  PaymentStatus.REFUNDED,
                  PaymentStatus.PARTIALLY_REFUNDED,
                ].some((status) => status === currentPayment.status)
              ) {
                throw new AppError(
                  "Group settlement payment state requires reconciliation",
                  503,
                );
              }

              await tx.stripeWebhookEvent.create({
                data: {
                  id: event.id,
                  type: event.type,
                },
              });

              return "ALREADY_SETTLED";
            }
          }

          if (
            [PaymentStatus.REFUNDED, PaymentStatus.PARTIALLY_REFUNDED].includes(
              currentPayment.status as "REFUNDED" | "PARTIALLY_REFUNDED",
            )
          ) {
            return "REFUND_REQUIRED";
          }

          // =================================================
          // 5. CHECK ACTIVE RESERVATION
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
              id: {
                not: currentPayment.id,
              },
            },
          });

          if (!activeReservation || otherPaidPayments > 0) {
            if (currentPayment.status !== PaymentStatus.REFUNDED) {
              await tx.payment.update({
                where: {
                  id: currentPayment.id,
                },
                data: {
                  status: PaymentStatus.PAID,
                  paidAt: currentPayment.paidAt ?? now,
                  failedAt: null,
                },
              });
            }

            // Expire an unpaid reservation and release inventory.

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
          // 6. VALIDATE INITIAL APPOINTMENT
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
          // 7. SETTLE GROUP PURCHASE
          // =================================================

          const updatedPurchase = await tx.groupPurchase.updateMany({
            where: {
              id: purchase.id,
              paymentStatus: PaymentStatus.PENDING,
              reservationExpiresAt: {
                gt: now,
              },
            },
            data: {
              paymentStatus: expectedPurchaseStatus,
              settledPaymentId: currentPayment.id,
              emailPurchaseConfirmedAt: now,
              purchasedAt: now,
              reservationExpiresAt: null,
            },
          });

          if (updatedPurchase.count !== 1) {
            throw new AppError("Purchase settlement conflict", 409);
          }

          // =================================================
          // 8. SETTLE PACKAGE INVENTORY
          // =================================================

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
          // 9. UPDATE DIRECT BOOK APPOINTMENT
          // =================================================

          if (isBookNow && appointment) {
            const appointmentStatus = isDeposit
              ? AppointmentStatus.RESERVED
              : AppointmentStatus.CONFIRMED;

            const appointmentPaymentStatus = isDeposit
              ? PaymentStatus.PARTIALLY_PAID
              : PaymentStatus.PAID;

            const qrToken = crypto.randomBytes(32).toString("hex");

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
          // 10. MARK PAYMENT PAID
          // =================================================

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

          // =================================================
          // 11. CUSTOMER NOTIFICATION
          // =================================================

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

          // =================================================
          // 12. MARK WEBHOOK PROCESSED
          // =================================================

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

  // =====================================================
  // 13. HANDLE SETTLEMENT RESULT
  // =====================================================

  if (
    settlementResult === "SETTLED" ||
    settlementResult === "ALREADY_SETTLED" ||
    settlementResult === "EVENT_PROCESSED"
  ) {
    return {
      received: true as const,
    };
  }

  if (settlementResult !== "REFUND_REQUIRED") {
    throw new AppError("Group purchase settlement outcome unknown", 503);
  }

  // =====================================================
  // 14. LATE / DUPLICATE PAYMENT REFUND
  // =====================================================

  const localRefund = await getOrCreateLateGroupPurchaseRefund(
    payment.id,
    payment.amount,
  );

  let providerRefundId: string | null;

  try {
    const result = await ensureLateGroupPurchaseRefund(localRefund.id);

    if (
      result.requiresInvestigation ||
      result.status !== RefundStatus.SUCCEEDED ||
      !result.providerRefundId
    ) {
      throw new AppError(
        "Stripe refund pending or requires investigation",
        503,
      );
    }

    providerRefundId = result.providerRefundId;
  } catch (error) {
    logUnexpectedError(error, {
      source: "handleGroupPurchaseStripeEvent:lateRefund",
    });

    if (error instanceof AppError) throw error;

    throw new AppError(
      "Stripe refund outcome is uncertain; reconciliation required",
      503,
    );
  }

  // =====================================================
  // 15. FINALIZE REFUND LOCALLY
  // =====================================================

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`
            SELECT "id"
            FROM "Payment"
            WHERE "id" = ${payment.id}
            FOR UPDATE
          `;

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
            // =============================================
            // 15.1 REFUND -> SUCCEEDED
            // =============================================

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

            // =============================================
            // 15.2 PAYMENT -> REFUNDED
            // =============================================

            await tx.payment.update({
              where: {
                id: currentPayment.id,
              },
              data: {
                status: PaymentStatus.REFUNDED,
                refundedAt,
              },
            });

            // =============================================
            // 15.3 AUDIT LOG
            // =============================================

            await auditLogService.createAuditLog(
              {
                userId: null,
                action: "LATE_GROUP_PURCHASE_REFUNDED",
                entityType: "PAYMENT",
                entityId: payment.id,
                metadata: {
                  refundId: currentRefund.id,
                  providerRefundId,
                  amount: Number(currentRefund.amount),
                  currency: payment.currency,
                },
              },
              tx,
            );

            // =============================================
            // 15.4 CUSTOMER NOTIFICATION
            // =============================================

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

          // ===============================================
          // 15.5 MARK WEBHOOK PROCESSED
          // ===============================================

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
}

const handleGroupPurchaseRemainingStripeEvent = async (
  event: Stripe.Event,
  paymentIntent: Stripe.PaymentIntent,
) => {
  // =====================================================
  // 1. FIND PAYMENT
  // =====================================================

  const payment = await prisma.payment.findUnique({
    where: {
      providerPaymentId: paymentIntent.id,
    },
  });

  if (
    !payment ||
    !payment.groupPurchaseId ||
    payment.purpose !== PaymentPurpose.GROUP_PURCHASE ||
    payment.provider !== PaymentProvider.STRIPE
  ) {
    throw new AppError("Group remaining payment not found", 404);
  }

  // =====================================================
  // 2. VERIFY STRIPE PAYMENT IDENTITY
  // =====================================================

  const expectedCents = stripeAmount(payment.amount, payment.currency);

  if (
    paymentIntent.metadata?.paymentStage !== "REMAINING" ||
    paymentIntent.metadata?.paymentId !== payment.id ||
    paymentIntent.metadata?.groupPurchaseId !== payment.groupPurchaseId ||
    paymentIntent.metadata?.customerId !== payment.customerId ||
    paymentIntent.metadata?.purpose !== PaymentPurpose.GROUP_PURCHASE ||
    paymentIntent.metadata?.bookingMethod !== BookingMethod.DEPOSIT ||
    paymentIntent.metadata?.purchaseFlow !== GroupPurchaseFlow.DIRECT_BOOK ||
    paymentIntent.currency.toLowerCase() !== payment.currency.toLowerCase() ||
    paymentIntent.amount !== expectedCents
  ) {
    throw new AppError("Group remaining Stripe payment mismatch", 409);
  }

  // =====================================================
  // 3. HANDLE FAILED PAYMENT
  // =====================================================

  if (event.type === "payment_intent.payment_failed") {
    await prisma.$transaction(async (tx) => {
      const existingEvent = await tx.stripeWebhookEvent.findUnique({
        where: {
          id: event.id,
        },
      });

      if (existingEvent) return;

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
    });

    return {
      received: true as const,
    };
  }

  if (event.type !== "payment_intent.succeeded") {
    return {
      received: true as const,
    };
  }

  if (
    paymentIntent.status !== "succeeded" ||
    paymentIntent.amount_received !== expectedCents
  ) {
    throw new AppError("Stripe remaining payment not successful", 409);
  }

  // =====================================================
  // 4. SETTLE REMAINING PAYMENT
  // =====================================================

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const settlement = await prisma.$transaction(
        async (tx) => {
          // Serialize settlement for this purchase.
          await tx.$queryRaw`
            SELECT "id"
            FROM "GroupPurchase"
            WHERE "id" = ${payment.groupPurchaseId!}
            FOR UPDATE
          `;

          // =================================================
          // 4.1 WEBHOOK IDEMPOTENCY
          // =================================================

          const existingEvent = await tx.stripeWebhookEvent.findUnique({
            where: {
              id: event.id,
            },
          });

          if (existingEvent) {
            return {
              received: true as const,
            };
          }

          // =================================================
          // 4.2 FETCH CURRENT PURCHASE AND PAYMENT
          // =================================================

          const purchase = await tx.groupPurchase.findUnique({
            where: {
              id: payment.groupPurchaseId!,
            },
            include: {
              appointments: {
                select: {
                  id: true,
                  customerId: true,
                  bookingMethod: true,
                  appointmentStatus: true,
                  paymentStatus: true,
                  qrVerifiedAt: true,
                  currency: true,
                },
              },
            },
          });

          const currentPayment = await tx.payment.findUnique({
            where: {
              id: payment.id,
            },
          });

          if (!purchase || !currentPayment) {
            throw new AppError("Payment or purchase not found", 404);
          }

          // =================================================
          // 4.3 VERIFY CURRENT PAYMENT IDENTITY
          // =================================================

          if (
            currentPayment.customerId !== payment.customerId ||
            currentPayment.groupPurchaseId !== purchase.id ||
            currentPayment.purpose !== PaymentPurpose.GROUP_PURCHASE ||
            currentPayment.provider !== PaymentProvider.STRIPE ||
            currentPayment.providerPaymentId !== paymentIntent.id ||
            !currentPayment.amount.equals(payment.amount) ||
            currentPayment.currency !== payment.currency
          ) {
            throw new AppError(
              "Group remaining payment identity mismatch",
              409,
            );
          }

          // =================================================
          // 4.4 VERIFY ORIGINAL PURCHASE CURRENCY
          // =================================================

          // Resolve historical purchase currency using
          // existing currency evidence.
          // Do not use current Brand currency as fallback.

          const purchaseCurrency = await getPurchaseCurrency(tx, purchase.id);

          if (
            currentPayment.currency !== purchaseCurrency ||
            payment.currency !== purchaseCurrency ||
            (purchase.currency !== null &&
              purchase.currency !== purchaseCurrency) ||
            purchase.appointments.some(
              (item) => item.currency !== purchaseCurrency,
            )
          ) {
            // Stripe has already captured the payment.
            // Do not silently settle or change currency.
            // Leave this event retryable for reconciliation.
            throw new AppError(
              "Group remaining payment currency conflict; reconciliation required",
              503,
            );
          }

          // =================================================
          // 4.5 CHECK EXISTING LATE REFUND
          // =================================================

          const captureRefund = await tx.refund.findFirst({
            where: {
              paymentId: currentPayment.id,
              reason: "LATE_GROUP_PURCHASE_PAYMENT",
            },
          });

          if (captureRefund) {
            return {
              received: true as const,
              refundRequired: true,
            };
          }

          // =================================================
          // 4.6 ALREADY PROCESSED PAYMENT
          // =================================================

          if (
            [
              PaymentStatus.PAID,
              PaymentStatus.PARTIALLY_REFUNDED,
              PaymentStatus.REFUNDED,
            ].includes(
              currentPayment.status as
                | "PAID"
                | "PARTIALLY_REFUNDED"
                | "REFUNDED",
            )
          ) {
            // Only treat as idempotent if the purchase
            // and appointment have actually been settled.
            if (
              currentPayment.status === PaymentStatus.PAID &&
              purchase.paymentStatus !== PaymentStatus.PAID
            ) {
              throw new AppError(
                "Paid remaining payment requires reconciliation",
                503,
              );
            }

            await tx.stripeWebhookEvent.create({
              data: {
                id: event.id,
                type: event.type,
              },
            });

            return {
              received: true as const,
            };
          }

          // =================================================
          // 4.7 REJECT CAPTURE AND PREPARE REFUND
          // =================================================

          const rejectCapture = async () => {
            await getOrCreateLateGroupPurchaseRefund(
              currentPayment.id,
              currentPayment.amount,
              tx,
            );

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

            return {
              received: true as const,
              refundRequired: true,
            };
          };

          // =====================================================
          // 5. VALIDATE PURCHASE AND REMAINING AMOUNT
          // =====================================================

          if (
            purchase.customerId !== payment.customerId ||
            purchase.purchaseFlow !== GroupPurchaseFlow.DIRECT_BOOK ||
            purchase.bookingMethod !== BookingMethod.DEPOSIT ||
            !purchase.depositAmount ||
            purchase.depositAmount.lte(0) ||
            purchase.depositAmount.gte(purchase.amount) ||
            !purchase.amount
              .minus(purchase.depositAmount)
              .equals(currentPayment.amount)
          ) {
            return rejectCapture();
          }

          if (purchase.appointments.length !== 1) {
            return rejectCapture();
          }

          const appointment = purchase.appointments[0];

          if (
            appointment.customerId !== purchase.customerId ||
            appointment.bookingMethod !== BookingMethod.DEPOSIT ||
            appointment.currency !== purchaseCurrency ||
            paymentIntent.metadata?.appointmentId !== appointment.id
          ) {
            return rejectCapture();
          }

          // =====================================================
          // 6. VERIFY ORIGINAL DEPOSIT PAYMENT
          // =====================================================

          const depositPayment = await tx.payment.findUnique({
            where: {
              id: purchase.settledPaymentId ?? "",
            },
          });

          if (
            !depositPayment ||
            depositPayment.id === currentPayment.id ||
            depositPayment.groupPurchaseId !== purchase.id ||
            depositPayment.customerId !== purchase.customerId ||
            depositPayment.purpose !== PaymentPurpose.GROUP_PURCHASE ||
            depositPayment.status !== PaymentStatus.PAID ||
            !depositPayment.amount.equals(purchase.depositAmount)
          ) {
            return rejectCapture();
          }

          // Currency conflicts are reconciliation issues,
          // not ordinary invalid-booking refunds.
          if (depositPayment.currency !== purchaseCurrency) {
            throw new AppError(
              "Original group deposit currency mismatch; reconciliation required",
              503,
            );
          }

          // =====================================================
          // 7. IDEMPOTENT ALREADY-PAID CHECK
          // =====================================================

          if (
            purchase.paymentStatus === PaymentStatus.PAID &&
            appointment.paymentStatus === PaymentStatus.PAID &&
            currentPayment.status === PaymentStatus.PAID
          ) {
            await tx.stripeWebhookEvent.create({
              data: {
                id: event.id,
                type: event.type,
              },
            });

            return {
              received: true as const,
            };
          }

          // =====================================================
          // 8. REQUIRE QR-VERIFIED APPOINTMENT
          // =====================================================

          if (
            purchase.paymentStatus !== PaymentStatus.PARTIALLY_PAID ||
            appointment.appointmentStatus !== AppointmentStatus.CONFIRMED ||
            appointment.paymentStatus !== PaymentStatus.PARTIALLY_PAID ||
            !appointment.qrVerifiedAt
          ) {
            return rejectCapture();
          }

          // =====================================================
          // 9. PREVENT DUPLICATE REMAINING SETTLEMENT
          // =====================================================

          const otherSettled = await tx.payment.findFirst({
            where: {
              groupPurchaseId: purchase.id,
              purpose: PaymentPurpose.GROUP_PURCHASE,
              id: {
                notIn: [depositPayment.id, currentPayment.id],
              },
              status: {
                in: [PaymentStatus.PAID, PaymentStatus.PARTIALLY_REFUNDED],
              },
            },
          });

          if (otherSettled) {
            return rejectCapture();
          }

          // =====================================================
          // 10. SETTLE GROUP PURCHASE
          // =====================================================

          const updatedPurchase = await tx.groupPurchase.updateMany({
            where: {
              id: purchase.id,
              paymentStatus: PaymentStatus.PARTIALLY_PAID,
            },
            data: {
              paymentStatus: PaymentStatus.PAID,
            },
          });

          if (updatedPurchase.count !== 1) {
            throw new AppError(
              "Group remaining payment settlement conflict",
              409,
            );
          }

          // =====================================================
          // 11. SETTLE APPOINTMENT
          // =====================================================

          const updatedAppointment = await tx.appointment.updateMany({
            where: {
              id: appointment.id,
              groupPurchaseId: purchase.id,
              appointmentStatus: AppointmentStatus.CONFIRMED,
              paymentStatus: PaymentStatus.PARTIALLY_PAID,
              qrVerifiedAt: {
                not: null,
              },
            },
            data: {
              paymentStatus: PaymentStatus.PAID,
            },
          });

          if (updatedAppointment.count !== 1) {
            throw new AppError(
              "Group appointment remaining settlement conflict",
              409,
            );
          }

          // =====================================================
          // 12. MARK PAYMENT PAID
          // =====================================================

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

          // =====================================================
          // 13. AUDIT LOG
          // =====================================================

          await auditLogService.createAuditLog(
            {
              userId: null,
              action: "GROUP_PURCHASE_REMAINING_PAYMENT_RECEIVED",
              entityType: "GROUP_PURCHASE",
              entityId: purchase.id,
              metadata: {
                paymentId: currentPayment.id,
                appointmentId: appointment.id,
                provider: PaymentProvider.STRIPE,
                providerPaymentId: paymentIntent.id,
                amount: Number(currentPayment.amount),
                currency: currentPayment.currency,
              },
            },
            tx,
          );

          // =====================================================
          // 14. MARK WEBHOOK PROCESSED
          // =====================================================

          await tx.stripeWebhookEvent.create({
            data: {
              id: event.id,
              type: event.type,
            },
          });

          return {
            received: true as const,
          };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 10000,
          timeout: 15000,
        },
      );

      // =====================================================
      // 15. REFUND RECONCILIATION
      // =====================================================

      if ("refundRequired" in settlement && settlement.refundRequired) {
        return reconcileUnappliedCapture(payment.id, event);
      }

      return settlement;
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

  throw new AppError("Group remaining payment settlement retry failed", 503);
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

const getMyPayments = async (
  customerId: string,
  query: IMyPaymentsQuery,
  language: Language = DEFAULT_LANGUAGE,
) => {
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
  // 2. CATEGORY FILTER
  // =====================================================

  const category = query.category ?? "ALL";

  const categoryWhere =
    category === "GROUP_PURCHASE"
      ? {
          purpose: { not: PaymentPurpose.WALLET_TOP_UP },
          OR: [
            { purpose: PaymentPurpose.GROUP_PURCHASE },
            { groupPurchaseId: { not: null } },
            { appointment: { is: { groupPurchaseId: { not: null } } } },
          ],
        }
      : category === "WALLET_TOPUP"
        ? {
            purpose: PaymentPurpose.WALLET_TOP_UP,
          }
        : category === "REGULAR_PURCHASE"
          ? {
              purpose: {
                in: [
                  PaymentPurpose.APPOINTMENT,
                  PaymentPurpose.APPOINTMENT_DEPOSIT,
                  PaymentPurpose.APPOINTMENT_REMAINING,
                ],
              },
              groupPurchaseId: null,
              OR: [
                { appointment: { is: null } },
                { appointment: { is: { groupPurchaseId: null } } },
              ],
            }
          : {};

  const where = {
    customerId,

    ...(query.status
      ? {
          status: query.status as PaymentStatus,
        }
      : {}),

    ...categoryWhere,
  };

  // =====================================================
  // 3. FETCH PAYMENTS + TOTAL
  // =====================================================

  const purchaseSelect = {
    id: true,
    orderNumber: true,
    package: {
      select: {
        id: true, name: true, translations: true,
        services: { select: { service: { select: { id: true, name: true, translations: true } } } },
      },
    },
  } satisfies Prisma.GroupPurchaseSelect;

  const [payments, total] = await prisma.$transaction([
    prisma.payment.findMany({
      where,

      skip,
      take: limit,

      orderBy: [{ createdAt: "desc" }, { id: "desc" }],

      select: {
        id: true,
        orderNumber: true,

        amount: true,
        currency: true,
        status: true,
        provider: true,
        providerPaymentId: true,

        appointmentId: true,
        groupPurchaseId: true,
        walletTopupId: true,

        createdAt: true,
        purpose: true,

        appointment: {
          select: {
            orderNumber: true,
            itemName: true,
            itemNameTranslations: true,
            groupPurchaseId: true,
          },
        },

        walletTopup: {
          select: {
            payments: {
              where: { orderNumber: { not: null }, customerId },
              orderBy: [{ createdAt: "asc" }, { id: "asc" }],
              take: 1,
              select: { orderNumber: true },
            },
          },
        },

        groupPurchase: { select: purchaseSelect },
      },
    }),

    prisma.payment.count({
      where,
    }),
  ]);

  // Resolve appointment-only historical links once per page, without adding
  // per-payment queries or loading the same purchase twice on normal records.
  const missingPurchaseIds = [...new Set(payments.flatMap((payment) =>
    payment.purpose !== PaymentPurpose.WALLET_TOP_UP && !payment.groupPurchase && payment.appointment?.groupPurchaseId
      ? [payment.appointment.groupPurchaseId]
      : [],
  ))];
  const linkedPurchases = missingPurchaseIds.length
    ? await prisma.groupPurchase.findMany({
        where: { id: { in: missingPurchaseIds }, customerId },
        select: purchaseSelect,
      })
    : [];
  const linkedPurchaseMap = new Map(linkedPurchases.map((purchase) => [purchase.id, purchase]));

  // =====================================================
  // 4. SUCCESSFUL REFUND TOTALS
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

  const refundedAmountMap = new Map<string, number>();

  for (const refund of refundTotals) {
    refundedAmountMap.set(refund.paymentId, Number(refund._sum.amount ?? 0));
  }

  // =====================================================
  // 5. PAYMENT LABELS
  // =====================================================

  const paymentLabels: Record<PaymentPurpose, string> = {
    [PaymentPurpose.APPOINTMENT]: "Appointment Payment",
    [PaymentPurpose.GROUP_PURCHASE]: "Group Purchase",
    [PaymentPurpose.WALLET_TOP_UP]: "Wallet Top Up",
    [PaymentPurpose.APPOINTMENT_DEPOSIT]: "Appointment Deposit",
    [PaymentPurpose.APPOINTMENT_REMAINING]: "Appointment Remaining Payment",
  };

  // =====================================================
  // 6. BATCH REFUND ELIGIBILITY
  // =====================================================

  const eligibilityMap = await getPaymentsRefundEligibilityBatch(
    customerId,
    payments.map((payment) => ({
      id: payment.id,
      purpose: payment.purpose,
      status: payment.status,
      appointmentId: payment.appointmentId,
      groupPurchaseId: payment.groupPurchaseId,
    })),
  );

  // =====================================================
  // 7. BUILD PAYMENT HISTORY
  // =====================================================

  const items: IMyPaymentItem[] = payments.map((payment) => {
    const refundEligibility = eligibilityMap.get(payment.id);

    if (!refundEligibility) {
      throw new AppError("PAYMENT_REFUND_ELIGIBILITY_MISSING", 500);
    }

    // =================================================
    // CATEGORY
    // =================================================

    const paymentCategory:
      | "GROUP_PURCHASE"
      | "REGULAR_PURCHASE"
      | "WALLET_TOPUP" =
      payment.purpose === PaymentPurpose.WALLET_TOP_UP
        ? "WALLET_TOPUP"
        : payment.purpose === PaymentPurpose.GROUP_PURCHASE ||
            payment.groupPurchaseId !== null ||
            payment.appointment?.groupPurchaseId != null
          ? "GROUP_PURCHASE"
          : "REGULAR_PURCHASE";

    // =================================================
    // LOCALIZED GROUP PURCHASE PACKAGE
    // =================================================

    const groupPurchase = payment.groupPurchase ?? linkedPurchaseMap.get(payment.appointment?.groupPurchaseId ?? "");
    const groupPackage = groupPurchase?.package;

    const localizedPackage = groupPackage
      ? getLocalizedContent(groupPackage.translations, language, {
          name: groupPackage.name,
        })
      : null;

    // =================================================
    // LOCALIZED SERVICES
    // =================================================

    const services =
      groupPackage?.services.map((entry) => {
        const localizedService = getLocalizedContent(
          entry.service.translations,
          language,
          {
            name: entry.service.name,
          },
        );

        return {
          id: entry.service.id,
          name: localizedService.name,
        };
      }) ?? [];

    // =================================================
    // LOCALIZED APPOINTMENT NAME
    // =================================================

    const appointmentName = payment.appointment
      ? getLocalizedContent(
          payment.appointment.itemNameTranslations,
          language,
          {
            name: payment.appointment.itemName,
          },
        ).name
      : null;

    // =================================================
    // DISPLAY NAME
    // =================================================

    const itemName =
      localizedPackage?.name ??
      appointmentName ??
      (paymentCategory === "WALLET_TOPUP" ? "Wallet Top-up" : null);

    // =================================================
    // ORDER ID
    // =================================================

    const orderId =
      paymentCategory === "GROUP_PURCHASE"
        ? (payment.groupPurchaseId ??
          payment.appointment?.groupPurchaseId ??
          payment.id)
        : paymentCategory === "WALLET_TOPUP"
          ? (payment.walletTopupId ?? payment.id)
          : (payment.appointmentId ?? payment.id);

    // =================================================
    // CANONICAL ORDER NUMBER
    // =================================================

    // GROUP_PURCHASE:
    //   Prefer GroupPurchase.orderNumber.
    //   Fall back to legacy Payment / Appointment values.
    //
    // REGULAR_PURCHASE:
    //   The appointment identifies the logical order across payment stages.
    //
    // WALLET_TOPUP:
    //   Preserve existing Payment.orderNumber behavior.

    const orderNumber =
      paymentCategory === "GROUP_PURCHASE"
        ? (groupPurchase?.orderNumber ??
          payment.orderNumber ??
          payment.appointment?.orderNumber ??
          null)
        : paymentCategory === "REGULAR_PURCHASE"
          ? (payment.appointment?.orderNumber ?? payment.orderNumber ?? null)
          : (payment.walletTopup?.payments[0]?.orderNumber ?? payment.orderNumber ?? null);

    // =================================================
    // RESPONSE
    // =================================================

    return {
      id: payment.id,

      orderNumber,
      orderId,
      category: paymentCategory,

      itemName,
      services,

      amount: Number(payment.amount),
      currency: payment.currency,

      paymentStatus: payment.status,

      provider: payment.provider,
      providerPaymentId: payment.providerPaymentId,

      appointmentId: payment.appointmentId,
      groupPurchaseId: payment.groupPurchaseId,
      walletTopupId: payment.walletTopupId,

      createdAt: payment.createdAt,
      purpose: payment.purpose,

      label: paymentLabels[payment.purpose] ?? "Payment",

      refundedAmount: refundedAmountMap.get(payment.id) ?? 0,

      canRefund: refundEligibility.canRefund,
      refundBlockedReason: refundEligibility.refundBlockedReason,
    };
  });

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
          assertCurrencyAmount(paidRefund, payment.currency);
          assertCurrencyAmount(bonusRefund, payment.currency);

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

const createAppointmentRemainingStripeIntent = async (
  customerId: string,
  appointmentId: string,
) => {
  // =====================================================
  // 1. FIND APPOINTMENT
  // =====================================================

  const appointment = await prisma.appointment.findUnique({
    where: {
      id: appointmentId,
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
      qrVerifiedAt: true,
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
  // 3. NORMAL DEPOSIT APPOINTMENT ONLY
  // =====================================================

  if (appointment.groupPurchaseId !== null) {
    throw new AppError(
      "Group Purchase remaining payment requires a separate endpoint",
      409,
    );
  }

  if (appointment.bookingMethod !== BookingMethod.DEPOSIT) {
    throw new AppError(
      "Remaining payment is only available for deposit appointments",
      409,
    );
  }

  // =====================================================
  // 4. REQUIRE CONFIRMED APPOINTMENT + PARTIAL PAYMENT
  // =====================================================

  if (
    appointment.appointmentStatus !== AppointmentStatus.CONFIRMED ||
    appointment.paymentStatus !== PaymentStatus.PARTIALLY_PAID ||
    !appointment.qrVerifiedAt
  ) {
    throw new AppError(
      "Appointment must be QR verified and confirmed before remaining payment",
      409,
    );
  }

  // =====================================================
  // 5. VALIDATE REMAINING AMOUNT
  // =====================================================

  if (!appointment.depositAmount || appointment.depositAmount.lte(0)) {
    throw new AppError("Invalid appointment deposit amount", 409);
  }

  const calculatedRemaining = appointment.price.minus(
    appointment.depositAmount,
  );

  const remainingAmount = appointment.remainingAmount ?? calculatedRemaining;

  if (
    !remainingAmount.isFinite() ||
    remainingAmount.lte(0) ||
    !remainingAmount.equals(calculatedRemaining)
  ) {
    throw new AppError("Invalid remaining payment amount", 409);
  }

  currencyDigits(appointment.currency);

  const amountInCents = stripeAmount(remainingAmount, appointment.currency);

  if (
    !Number.isSafeInteger(amountInCents) ||
    amountInCents < (appointment.currency === "HKD" ? 400 : 1)
  ) {
    throw new AppError(
      "Remaining amount is below the supported Stripe minimum",
      422,
    );
  }

  // =====================================================
  // 6. CREATE OR REUSE LOCAL PAYMENT ATTEMPT
  // =====================================================

  let payment: Prisma.PaymentGetPayload<{}> | undefined;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      payment = await prisma.$transaction(
        async (tx) => {
          // Lock appointment to serialize local payment attempts.

          await tx.$queryRaw`
            SELECT "id"
            FROM "Appointment"
            WHERE "id" = ${appointmentId}
            FOR UPDATE
          `;

          const current = await tx.appointment.findUnique({
            where: {
              id: appointmentId,
            },
          });

          if (
            !current ||
            current.customerId !== customerId ||
            current.groupPurchaseId !== null ||
            current.bookingMethod !== BookingMethod.DEPOSIT ||
            current.appointmentStatus !== AppointmentStatus.CONFIRMED ||
            current.paymentStatus !== PaymentStatus.PARTIALLY_PAID ||
            !current.qrVerifiedAt
          ) {
            throw new AppError(
              "Appointment is no longer eligible for remaining payment",
              409,
            );
          }

          const currentRemaining = current.price.minus(
            current.depositAmount ?? new Prisma.Decimal(0),
          );

          if (
            !currentRemaining.equals(remainingAmount) ||
            (current.remainingAmount !== null &&
              !current.remainingAmount.equals(remainingAmount))
          ) {
            throw new AppError("Appointment remaining amount changed", 409);
          }

          // Verify original deposit was paid.

          const paidDeposit = await tx.payment.findFirst({
            where: {
              appointmentId,
              customerId,
              purpose: PaymentPurpose.APPOINTMENT_DEPOSIT,
              status: PaymentStatus.PAID,
            },
          });

          if (
            !paidDeposit ||
            !paidDeposit.amount.equals(current.depositAmount!)
          ) {
            throw new AppError(
              "Paid appointment deposit could not be verified",
              409,
            );
          }

          // Block an already settled remaining payment.

          const settledPayment = await tx.payment.findFirst({
            where: {
              appointmentId,
              purpose: PaymentPurpose.APPOINTMENT_REMAINING,
              status: {
                in: [PaymentStatus.PAID, PaymentStatus.PARTIALLY_REFUNDED],
              },
            },
          });

          if (settledPayment) {
            throw new AppError(
              "Remaining payment has already been completed",
              409,
            );
          }

          // Reuse an existing pending Stripe payment.

          const existingPending = await tx.payment.findFirst({
            where: {
              appointmentId,
              purpose: PaymentPurpose.APPOINTMENT_REMAINING,
              status: PaymentStatus.PENDING,
            },
            orderBy: {
              createdAt: "asc",
            },
          });

          if (existingPending) {
            if (
              existingPending.provider !== PaymentProvider.STRIPE ||
              existingPending.customerId !== customerId ||
              !existingPending.amount.equals(remainingAmount) ||
              existingPending.currency !== current.currency
            ) {
              throw new AppError(
                "Another remaining payment attempt is pending",
                409,
              );
            }

            return existingPending;
          }

          return tx.payment.create({
            data: {
              customerId,
              appointmentId,
              purpose: PaymentPurpose.APPOINTMENT_REMAINING,
              provider: PaymentProvider.STRIPE,
              amount: remainingAmount,
              currency: current.currency,
              status: PaymentStatus.PENDING,
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

  if (!payment) {
    throw new AppError("Unable to create remaining payment attempt", 409);
  }

  // =====================================================
  // 7. REUSE OR CREATE STRIPE PAYMENT INTENT
  // =====================================================

  let paymentIntent: Stripe.PaymentIntent;

  try {
    if (payment.providerPaymentId) {
      paymentIntent = await stripe.paymentIntents.retrieve(
        payment.providerPaymentId,
      );
    } else {
      paymentIntent = await stripe.paymentIntents.create(
        {
          amount: amountInCents,
          currency: appointment.currency.toLowerCase(),

          metadata: {
            paymentId: payment.id,
            appointmentId,
            customerId,
            purpose: PaymentPurpose.APPOINTMENT_REMAINING,
            bookingMethod: BookingMethod.DEPOSIT,
          },

          automatic_payment_methods: {
            enabled: true,
            allow_redirects: "never",
          },
        },
        {
          idempotencyKey: `appointment-remaining-intent-${payment.id}`,
        },
      );

      // Persist Stripe intent identity without overwriting
      // another concurrent request's value.

      const saved = await prisma.payment.updateMany({
        where: {
          id: payment.id,
          provider: PaymentProvider.STRIPE,
          status: PaymentStatus.PENDING,
          providerPaymentId: null,
        },
        data: {
          providerPaymentId: paymentIntent.id,
        },
      });

      if (saved.count !== 1) {
        const latestPayment = await prisma.payment.findUnique({
          where: {
            id: payment.id,
          },
        });

        if (
          !latestPayment ||
          latestPayment.providerPaymentId !== paymentIntent.id
        ) {
          throw new AppError(
            "Remaining payment attempt changed; reconciliation required",
            409,
          );
        }
      }
    }

    // =====================================================
    // 8. VERIFY STRIPE PAYMENT INTENT
    // =====================================================

    if (
      paymentIntent.amount !== amountInCents ||
      paymentIntent.currency.toLowerCase() !==
        appointment.currency.toLowerCase() ||
      paymentIntent.metadata?.paymentId !== payment.id ||
      paymentIntent.metadata?.appointmentId !== appointmentId ||
      paymentIntent.metadata?.customerId !== customerId ||
      paymentIntent.metadata?.purpose !== PaymentPurpose.APPOINTMENT_REMAINING
    ) {
      throw new AppError(
        "Stripe PaymentIntent does not match remaining payment",
        409,
      );
    }

    const payableStatuses: Stripe.PaymentIntent.Status[] = [
      "requires_payment_method",
      "requires_confirmation",
      "requires_action",
    ];

    if (
      !paymentIntent.client_secret ||
      !payableStatuses.includes(paymentIntent.status)
    ) {
      throw new AppError(
        "Stripe remaining PaymentIntent is not in a payable state",
        409,
      );
    }

    // =====================================================
    // 9. RECHECK APPOINTMENT AFTER STRIPE NETWORK CALL
    // =====================================================

    const currentAppointment = await prisma.appointment.findUnique({
      where: {
        id: appointmentId,
      },
      select: {
        customerId: true,
        groupPurchaseId: true,
        bookingMethod: true,
        appointmentStatus: true,
        paymentStatus: true,
        qrVerifiedAt: true,
        price: true,
        depositAmount: true,
        remainingAmount: true,
      },
    });

    const currentExpectedRemaining = currentAppointment
      ? currentAppointment.price.minus(
          currentAppointment.depositAmount ?? new Prisma.Decimal(0),
        )
      : null;

    if (
      !currentAppointment ||
      currentAppointment.customerId !== customerId ||
      currentAppointment.groupPurchaseId !== null ||
      currentAppointment.bookingMethod !== BookingMethod.DEPOSIT ||
      currentAppointment.appointmentStatus !== AppointmentStatus.CONFIRMED ||
      currentAppointment.paymentStatus !== PaymentStatus.PARTIALLY_PAID ||
      !currentAppointment.qrVerifiedAt ||
      !currentExpectedRemaining?.equals(remainingAmount) ||
      (currentAppointment.remainingAmount !== null &&
        !currentAppointment.remainingAmount.equals(remainingAmount))
    ) {
      throw new AppError(
        "Appointment is no longer eligible for remaining payment",
        409,
      );
    }

    // =====================================================
    // 10. RESPONSE
    // =====================================================

    return {
      paymentId: payment.id,
      appointmentId,
      amount: Number(payment.amount),
      currency: payment.currency,
      paymentStatus: "PENDING" as const,
      clientSecret: paymentIntent.client_secret,
    };
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    logUnexpectedError(error, {
      source: "payment.service.ts:createAppointmentRemainingStripeIntent",
    });

    // Do not blindly mark the local payment FAILED.
    // Stripe might have created the intent before a network timeout.

    throw new AppError(
      "Unable to create remaining Stripe PaymentIntent; retry or reconcile",
      502,
    );
  }
};
export const paymentService = {
  createStripeIntent,
  handleStripeWebhook,
  getPaymentById,
  getMyPayments,
  refundPayment,
  createGroupPurchaseStripeIntent,
  handleGroupPurchaseStripeEvent,
  createAppointmentRemainingStripeIntent,
  createGroupPurchaseRemainingStripeIntent,
};
