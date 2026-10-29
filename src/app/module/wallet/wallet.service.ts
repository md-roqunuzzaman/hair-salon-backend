import {
  AppointmentStatus,
  BalanceType,
  BookingMethod,
  GroupPurchaseFlow,
  PaymentProvider,
  PaymentPurpose,
  PaymentStatus,
  Prisma,
  PromotionStatus,
  WalletTopupStatus,
  WalletTransactionType,
} from "../../../../generated/prisma/client.js";
import crypto from "node:crypto";
import { prisma } from "../../lib/prisma.js";
import { stripe } from "../../lib/stripe.js";
import { AppError } from "../../utils/app-error.js";
import { notificationService } from "../notification/notification.service.js";
import {
  ICreateWalletTopupPayload,
  ICreateWalletTopupResponse,
  IPayAppointmentWithWalletPayload,
  IPayAppointmentWithWalletResponse,
  IWalletResponse,
  IWalletTransactionItem,
  IWalletTransactionsQuery,
} from "./wallet.interface.js";
import { auditLogService } from "../auditLog/auditLog.service.js";
import { notificationTemplates } from "../notification/notification.templates.js";

const getMyWallet = async (customerId: string): Promise<IWalletResponse> => {
  let wallet = await prisma.wallet.findUnique({
    where: {
      customerId,
    },
  });

  if (!wallet) {
    wallet = await prisma.wallet.create({
      data: {
        customerId,
        paidBalance: 0,
        bonusBalance: 0,
        currency: "HKD",
      },
    });
  }

  const paidBalance = Number(wallet.paidBalance);

  const bonusBalance = Number(wallet.bonusBalance);

  return {
    paidBalance,
    bonusBalance,
    totalBalance: paidBalance + bonusBalance,
    currency: wallet.currency,
  };
};

const getMyTransactions = async (
  customerId: string,
  query: IWalletTransactionsQuery,
) => {
  const page = Number(query.page ?? 1);
  const limit = Number(query.limit ?? 20);

  if (page < 1) {
    throw new AppError("page must be at least 1", 400);
  }

  if (limit < 1 || limit > 100) {
    throw new AppError("limit must be between 1 and 100", 400);
  }

  const wallet = await prisma.wallet.findUnique({
    where: {
      customerId,
    },

    select: {
      id: true,
    },
  });

  // Wallet not created yet = no transaction history.
  if (!wallet) {
    return {
      items: [],
      pagination: {
        page,
        limit,
        total: 0,
        totalPages: 0,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    };
  }

  const where: Prisma.WalletTransactionWhereInput = {
    walletId: wallet.id,
  };

  if (query.type) {
    where.type = query.type as WalletTransactionType;
  }

  // HK timezone date boundaries.
  if (query.from || query.to) {
    where.createdAt = {};

    if (query.from) {
      where.createdAt.gte = new Date(`${query.from}T00:00:00+08:00`);
    }

    if (query.to) {
      where.createdAt.lte = new Date(`${query.to}T23:59:59.999+08:00`);
    }
  }

  const skip = (page - 1) * limit;

  const [transactions, total] = await prisma.$transaction([
    prisma.walletTransaction.findMany({
      where,

      skip,
      take: limit,

      orderBy: {
        createdAt: "desc",
      },

      select: {
        id: true,
        type: true,
        balanceType: true,
        amount: true,
        createdAt: true,
      },
    }),

    prisma.walletTransaction.count({
      where,
    }),
  ]);

  const items: IWalletTransactionItem[] = transactions.map((transaction) => ({
    id: transaction.id,

    type: transaction.type,

    balanceType: transaction.balanceType,

    amount: Number(transaction.amount),

    createdAt: transaction.createdAt.toISOString(),
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

const createTopup = async (
  customerId: string,
  payload: ICreateWalletTopupPayload,
): Promise<ICreateWalletTopupResponse> => {
  // =====================================================
  // 1. VALIDATE SELECTED PROMOTION
  // =====================================================

  const now = new Date();

  const promotion = await prisma.promotion.findFirst({
    where: {
      id: payload.promotionId,

      status: PromotionStatus.ACTIVE,

      startAt: {
        lte: now,
      },

      endAt: {
        gte: now,
      },

      // Wallet top-up promotions must be global.
      // Promotions linked to branches, services, or
      // packages cannot be used for wallet top-ups.
      branches: {
        none: {},
      },

      services: {
        none: {},
      },

      packages: {
        none: {},
      },
    },

    select: {
      id: true,
      minimumTopup: true,
      bonusAmount: true,
    },
  });

  if (!promotion) {
    throw new AppError("PROMOTION_NOT_FOUND_OR_NOT_ELIGIBLE", 400);
  }

  // =====================================================
  // 2. DETERMINE FIXED TOP-UP AMOUNT AND BONUS
  // =====================================================

  // Customer cannot provide a custom amount.
  // The selected promotion determines both values.

  const topupAmount = promotion.minimumTopup;
  const bonusAmount = promotion.bonusAmount;

  if (!topupAmount.isFinite() || topupAmount.lte(0)) {
    throw new AppError("INVALID_PROMOTION_TOPUP_AMOUNT", 400);
  }

  if (!bonusAmount.isFinite() || bonusAmount.lt(0)) {
    throw new AppError("INVALID_PROMOTION_BONUS_AMOUNT", 400);
  }

  // Convert HKD to Stripe's smallest currency unit.
  // Use Decimal arithmetic to avoid floating-point issues.

  const amountInCents = topupAmount.mul(100);

  if (
    !amountInCents.isInteger() ||
    amountInCents.lt(1) ||
    amountInCents.gt(99999999)
  ) {
    throw new AppError("INVALID_STRIPE_TOPUP_AMOUNT", 400);
  }

  const amount = Number(topupAmount);
  const potentialBonus = Number(bonusAmount);

  // =====================================================
  // 3. FIND OR CREATE CUSTOMER WALLET
  // =====================================================

  const wallet = await prisma.wallet.upsert({
    where: {
      customerId,
    },

    update: {},

    create: {
      customerId,
      paidBalance: 0,
      bonusBalance: 0,
      currency: "HKD",
    },
  });

  if (wallet.currency !== "HKD") {
    throw new AppError("UNSUPPORTED_WALLET_CURRENCY", 400);
  }

  // =====================================================
  // 4. CREATE TOP-UP AND PAYMENT RECORDS
  // =====================================================

  // Store promotion amount and bonus as snapshots.
  // Future promotion edits must not change this top-up.

  const { topup, payment } = await prisma.$transaction(async (tx) => {
    const topup = await tx.walletTopup.create({
      data: {
        walletId: wallet.id,

        promotionId: promotion.id,

        amount: topupAmount,

        potentialBonus: bonusAmount,

        status: WalletTopupStatus.PENDING,
      },
    });

    const payment = await tx.payment.create({
      data: {
        customerId,

        walletTopupId: topup.id,

        purpose: PaymentPurpose.WALLET_TOP_UP,

        amount: topupAmount,

        currency: "HKD",

        status: PaymentStatus.PENDING,
      },
    });

    return {
      topup,
      payment,
    };
  });

  // =====================================================
  // 5. CREATE STRIPE PAYMENT INTENT
  // =====================================================

  try {
    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount: amountInCents.toNumber(),

        currency: "hkd",

        metadata: {
          paymentId: payment.id,
          topupId: topup.id,
          walletId: wallet.id,
          customerId,
          promotionId: promotion.id,
          purpose: PaymentPurpose.WALLET_TOP_UP,
        },

        automatic_payment_methods: {
          enabled: true,
          allow_redirects: "never",
        },
      },

      {
        idempotencyKey: `wallet-topup-${topup.id}`,
      },
    );

    if (!paymentIntent.client_secret) {
      throw new Error("Stripe did not return client secret");
    }

    // =====================================================
    // 6. SAVE STRIPE PAYMENT INTENT ID
    // =====================================================

    await prisma.$transaction([
      prisma.walletTopup.update({
        where: {
          id: topup.id,
        },

        data: {
          providerPaymentId: paymentIntent.id,
        },
      }),

      prisma.payment.update({
        where: {
          id: payment.id,
        },

        data: {
          providerPaymentId: paymentIntent.id,
        },
      }),
    ]);

    // =====================================================
    // 7. RETURN TOP-UP PAYMENT DETAILS
    // =====================================================

    return {
      topupId: topup.id,

      promotionId: promotion.id,

      amount,

      potentialBonus,

      stripeClientSecret: paymentIntent.client_secret,
    };
  } catch (error) {
    // =====================================================
    // 8. HANDLE STRIPE OPERATION FAILURE
    // =====================================================

    await prisma.$transaction([
      prisma.walletTopup.update({
        where: {
          id: topup.id,
        },

        data: {
          status: WalletTopupStatus.FAILED,
          failedAt: new Date(),
        },
      }),

      prisma.payment.update({
        where: {
          id: payment.id,
        },

        data: {
          status: PaymentStatus.FAILED,
          failedAt: new Date(),
        },
      }),
    ]);

    throw new AppError("STRIPE_OPERATION_FAILED", 502);
  }
};

type WalletPaymentType = "APPOINTMENT_PAYMENT" | "GROUP_PURCHASE_PAYMENT";

const deductWalletBalance = async (
  tx: Prisma.TransactionClient,
  customerId: string,
  amount: Prisma.Decimal,
  useBonus: boolean,
  type: WalletPaymentType,
  referenceId: string,
) => {
  if (!amount.isFinite() || amount.lte(0)) {
    throw new AppError("INVALID_PAYMENT_AMOUNT", 400);
  }

  const wallet = await tx.wallet.findUnique({
    where: { customerId },
  });

  if (!wallet) {
    throw new AppError("INSUFFICIENT_WALLET_BALANCE", 422);
  }

  if (wallet.currency !== "HKD") {
    throw new AppError("UNSUPPORTED_WALLET_CURRENCY", 400);
  }

  const bonusBalanceUsed = useBonus
    ? Prisma.Decimal.min(wallet.bonusBalance, amount)
    : new Prisma.Decimal(0);

  const paidBalanceUsed = amount.minus(bonusBalanceUsed);

  if (wallet.paidBalance.lt(paidBalanceUsed)) {
    throw new AppError("INSUFFICIENT_WALLET_BALANCE", 422);
  }

  const updated = await tx.wallet.updateMany({
    where: {
      id: wallet.id,
      paidBalance: { gte: paidBalanceUsed },
      bonusBalance: { gte: bonusBalanceUsed },
    },
    data: {
      paidBalance: { decrement: paidBalanceUsed },
      bonusBalance: { decrement: bonusBalanceUsed },
    },
  });

  if (updated.count !== 1) {
    throw new AppError("WALLET_BALANCE_CHANGED", 409);
  }

  if (paidBalanceUsed.gt(0)) {
    await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type,
        balanceType: BalanceType.PAID,
        amount: paidBalanceUsed.negated(),
        referenceId,
      },
    });
  }

  if (bonusBalanceUsed.gt(0)) {
    await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type,
        balanceType: BalanceType.BONUS,
        amount: bonusBalanceUsed.negated(),
        referenceId,
      },
    });
  }

  const updatedWallet = await tx.wallet.findUniqueOrThrow({
    where: { id: wallet.id },
  });

  return {
    paidBalanceUsed: Number(paidBalanceUsed),
    bonusBalanceUsed: Number(bonusBalanceUsed),
    remainingPaidBalance: Number(updatedWallet.paidBalance),
    remainingBonusBalance: Number(updatedWallet.bonusBalance),
  };
};

const payAppointmentWithWallet = async (
  customerId: string,
  appointmentId: string,
  payload: IPayAppointmentWithWalletPayload,
): Promise<IPayAppointmentWithWalletResponse> => {
  // Retry serialization conflicts (P2034)
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          // ==========================================
          // 1. FIND APPOINTMENT
          // ==========================================

          const appointment = await tx.appointment.findUnique({
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
              holdExpiresAt: true,
            },
          });

          if (!appointment) {
            throw new AppError("APPOINTMENT_NOT_FOUND", 404);
          }

          // ==========================================
          // 2. OWNERSHIP
          // ==========================================

          if (appointment.customerId !== customerId) {
            throw new AppError(
              "You are not allowed to pay for this appointment",
              403,
            );
          }

          // Group Purchase uses its own payment flow.
          if (appointment.groupPurchaseId !== null) {
            throw new AppError(
              "Group Purchase-linked appointments must use the Group Purchase payment flow",
              409,
            );
          }

          // ==========================================
          // 3. BOOKING METHOD VALIDATION
          // ==========================================

          if (appointment.bookingMethod !== BookingMethod.PAY_NOW) {
            throw new AppError(
              "Wallet payment is only supported for Pay Now appointments",
              409,
            );
          }

          // ==========================================
          // 4. PAYMENT STATUS VALIDATION
          // ==========================================

          if (
            appointment.paymentStatus === PaymentStatus.PAID ||
            appointment.appointmentStatus === AppointmentStatus.CONFIRMED ||
            appointment.appointmentStatus === AppointmentStatus.COMPLETED
          ) {
            throw new AppError("PAYMENT_ALREADY_COMPLETED", 409);
          }

          if (
            appointment.appointmentStatus !== AppointmentStatus.PENDING_PAYMENT
          ) {
            throw new AppError("INVALID_APPOINTMENT_STATUS", 409);
          }

          if (appointment.paymentStatus !== PaymentStatus.PENDING) {
            throw new AppError("INVALID_PAYMENT_STATUS", 409);
          }

          // ==========================================
          // 5. HOLD EXPIRY VALIDATION
          // ==========================================

          const now = new Date();

          if (!appointment.holdExpiresAt || appointment.holdExpiresAt <= now) {
            throw new AppError("SLOT_HOLD_EXPIRED", 409);
          }

          // ==========================================
          // 6. CHECK EXISTING PAYMENTS
          // ==========================================

          const existingPayments = await tx.payment.findMany({
            where: {
              appointmentId: appointment.id,
              purpose: PaymentPurpose.APPOINTMENT,
              status: {
                in: [PaymentStatus.PENDING, PaymentStatus.PAID],
              },
            },
            select: {
              id: true,
              provider: true,
              status: true,
            },
          });

          if (
            existingPayments.some(
              (payment) => payment.status === PaymentStatus.PAID,
            )
          ) {
            throw new AppError("PAYMENT_ALREADY_COMPLETED", 409);
          }

          // Prevent wallet payment while a Stripe payment
          // may still complete asynchronously.
          if (
            existingPayments.some(
              (payment) =>
                payment.provider === PaymentProvider.STRIPE &&
                payment.status === PaymentStatus.PENDING,
            )
          ) {
            throw new AppError("STRIPE_PAYMENT_ALREADY_PENDING", 409);
          }

          // ==========================================
          // 7. ATOMIC WALLET DEDUCTION
          // ==========================================

          const walletResult = await deductWalletBalance(
            tx,
            customerId,
            appointment.price,
            payload.useBonus,
            "APPOINTMENT_PAYMENT",
            appointment.id,
          );

          // ==========================================
          // 8. GENERATE QR + GUARDED APPOINTMENT UPDATE
          // ==========================================

          const qrToken = crypto.randomBytes(32).toString("hex");

          const updated = await tx.appointment.updateMany({
            where: {
              id: appointment.id,
              customerId,
              groupPurchaseId: null,
              bookingMethod: BookingMethod.PAY_NOW,
              appointmentStatus: AppointmentStatus.PENDING_PAYMENT,
              paymentStatus: PaymentStatus.PENDING,
              holdExpiresAt: {
                gt: now,
              },
            },
            data: {
              paymentStatus: PaymentStatus.PAID,
              appointmentStatus: AppointmentStatus.CONFIRMED,
              holdExpiresAt: null,

              // QR is available only after successful payment.
              qrToken,
              qrVerifiedAt: null,
              qrVerifiedBy: null,
            },
          });

          if (updated.count !== 1) {
            throw new AppError("APPOINTMENT_PAYMENT_CONFLICT", 409);
          }

          // ==========================================
          // 9. CREATE WALLET PAYMENT RECORD
          // ==========================================

          await tx.payment.create({
            data: {
              customerId,
              appointmentId: appointment.id,
              purpose: PaymentPurpose.APPOINTMENT,
              provider: PaymentProvider.WALLET,
              amount: appointment.price,
              currency: "HKD",
              status: PaymentStatus.PAID,
              paidAt: now,
            },
          });

          // ==========================================
          // 10. BOOKING CONFIRMED NOTIFICATION
          // ==========================================

          await notificationService.createNotification(
            {
              appointmentId: appointment.id,
              userId: customerId,
              type: "BOOKING_CONFIRMED",
              title: "Booking confirmed",
              message: "Your appointment has been confirmed successfully.",
            },
            tx,
          );

          // ==========================================
          // 11. RESPONSE
          // ==========================================

          return {
            paymentStatus: "PAID" as const,
            ...walletResult,
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

  throw new AppError("WALLET_PAYMENT_RETRY_FAILED", 409);
};

const payGroupPurchaseWithWallet = async (
  customerId: string,
  purchaseId: string,
  payload: { useBonus: boolean },
) => {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const now = new Date();

          // =====================================================
          // 1. FIND PURCHASE
          // =====================================================

          await tx.$queryRaw`SELECT "id" FROM "GroupPurchase" WHERE "id" = ${purchaseId} FOR UPDATE`;
          const purchase = await tx.groupPurchase.findUnique({
            where: {
              id: purchaseId,
            },
            select: {
              id: true,
              customerId: true,
              packageId: true,
              quantity: true,
              amount: true,
              purchaseFlow: true,
              bookingMethod: true,
              depositAmount: true,
              paymentStatus: true,
              reservationExpiresAt: true,
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

          if (!purchase) {
            throw new AppError("GROUP_PURCHASE_NOT_FOUND", 404);
          }

          // =====================================================
          // 2. CHECK OWNERSHIP
          // =====================================================

          if (purchase.customerId !== customerId) {
            throw new AppError("FORBIDDEN_GROUP_PURCHASE", 403);
          }

          // =====================================================
          // 3. VALIDATE PURCHASE FLOW
          // =====================================================

          const isBookNow =
            purchase.purchaseFlow === GroupPurchaseFlow.DIRECT_BOOK;

          if (
            purchase.purchaseFlow !== GroupPurchaseFlow.BUY_NOW_BOOK_LATER &&
            !isBookNow
          ) {
            throw new AppError("UNSUPPORTED_PURCHASE_FLOW", 422);
          }

          const isDeposit =
            isBookNow && purchase.bookingMethod === BookingMethod.DEPOSIT;

          if (isBookNow) {
            if (purchase.bookingMethod === BookingMethod.RESERVE_NOW) {
              throw new AppError(
                "RESERVE_NOW_DOES_NOT_REQUIRE_INITIAL_WALLET_PAYMENT",
                422,
              );
            }

            if (
              purchase.bookingMethod !== BookingMethod.PAY_NOW &&
              purchase.bookingMethod !== BookingMethod.DEPOSIT
            ) {
              throw new AppError("UNSUPPORTED_BOOK_NOW_PAYMENT_METHOD", 422);
            }
          }

          // =====================================================
          // 4. VALIDATE PAYMENT STATUS
          // =====================================================

          if (
            purchase.paymentStatus === PaymentStatus.PAID ||
            purchase.paymentStatus === PaymentStatus.PARTIALLY_PAID
          ) {
            throw new AppError("PAYMENT_ALREADY_COMPLETED", 409);
          }

          if (purchase.paymentStatus !== PaymentStatus.PENDING) {
            throw new AppError("GROUP_PURCHASE_NOT_PAYABLE", 409);
          }

          // =====================================================
          // 5. CHECK RESERVATION EXPIRY
          // =====================================================

          if (
            !purchase.reservationExpiresAt ||
            purchase.reservationExpiresAt <= now
          ) {
            throw new AppError("GROUP_PURCHASE_RESERVATION_EXPIRED", 409);
          }

          // =====================================================
          // 6. DETERMINE WALLET PAYMENT AMOUNT
          // =====================================================

          const paymentAmount = isDeposit
            ? purchase.depositAmount
            : purchase.amount;

          if (
            !paymentAmount ||
            !paymentAmount.isFinite() ||
            paymentAmount.lte(0)
          ) {
            throw new AppError("INVALID_PAYMENT_AMOUNT", 422);
          }

          if (isDeposit && paymentAmount.gte(purchase.amount)) {
            throw new AppError("INVALID_DEPOSIT_AMOUNT", 422);
          }

          // =====================================================
          // 7. VALIDATE LINKED APPOINTMENT
          // =====================================================

          const initialAppointments = purchase.appointments.filter(
            (item) => item.bookingMethod === purchase.bookingMethod,
          );
          const appointment = isBookNow ? initialAppointments[0] : null;

          if (isBookNow) {
            if (initialAppointments.length !== 1 || !appointment) {
              throw new AppError("INVALID_BOOK_NOW_APPOINTMENT", 409);
            }

            if (
              appointment.appointmentStatus !==
                AppointmentStatus.PENDING_PAYMENT ||
              appointment.paymentStatus !== PaymentStatus.PENDING
            ) {
              throw new AppError("BOOK_NOW_APPOINTMENT_NOT_PAYABLE", 409);
            }
          }

          // =====================================================
          // 8. CHECK EXISTING PAYMENTS
          // =====================================================

          const existingPayments = await tx.payment.findMany({
            where: {
              groupPurchaseId: purchase.id,
              purpose: PaymentPurpose.GROUP_PURCHASE,
              status: {
                in: [PaymentStatus.PENDING, PaymentStatus.PAID],
              },
            },
            select: {
              provider: true,
              status: true,
            },
          });

          if (
            existingPayments.some(
              (payment) => payment.status === PaymentStatus.PAID,
            )
          ) {
            throw new AppError("PAYMENT_ALREADY_COMPLETED", 409);
          }

          // Prevent wallet payment when a Stripe payment
          // may still complete asynchronously.

          if (
            existingPayments.some(
              (payment) =>
                payment.provider === PaymentProvider.STRIPE &&
                payment.status === PaymentStatus.PENDING,
            )
          ) {
            throw new AppError("STRIPE_PAYMENT_ALREADY_PENDING", 409);
          }

          // =====================================================
          // 9. ATOMIC WALLET DEDUCTION
          // =====================================================

          const walletResult = await deductWalletBalance(
            tx,
            customerId,
            paymentAmount,
            payload.useBonus,
            "GROUP_PURCHASE_PAYMENT",
            purchase.id,
          );

          // =====================================================
          // 10. UPDATE PURCHASE
          // =====================================================

          const payment = await tx.payment.create({
            data: {
              customerId,
              groupPurchaseId: purchase.id,
              purpose: PaymentPurpose.GROUP_PURCHASE,
              provider: PaymentProvider.WALLET,
              amount: paymentAmount,
              currency: "HKD",
              status: PaymentStatus.PAID,
              paidAt: now,
            },
          });

          const nextPurchaseStatus = isDeposit
            ? PaymentStatus.PARTIALLY_PAID
            : PaymentStatus.PAID;

          const updatedPurchase = await tx.groupPurchase.updateMany({
            where: {
              id: purchase.id,
              customerId,
              paymentStatus: PaymentStatus.PENDING,
              reservationExpiresAt: {
                gt: now,
              },
            },
            data: {
              paymentStatus: nextPurchaseStatus,
              settledPaymentId: payment.id,
              purchasedAt: now,
              reservationExpiresAt: null,
            },
          });

          if (updatedPurchase.count !== 1) {
            throw new AppError("GROUP_PURCHASE_PAYMENT_CONFLICT", 409);
          }

          // =====================================================
          // 11. TRANSFER INVENTORY RESERVED -> SOLD
          // =====================================================

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
            throw new AppError("GROUP_PURCHASE_CAPACITY_CONFLICT", 409);
          }

          // =====================================================
          // 12. UPDATE FIRST BOOK NOW APPOINTMENT
          // =====================================================

          if (isBookNow && appointment) {
            const nextAppointmentStatus = isDeposit
              ? AppointmentStatus.RESERVED
              : AppointmentStatus.CONFIRMED;

            const nextAppointmentPaymentStatus = isDeposit
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
                appointmentStatus: nextAppointmentStatus,
                paymentStatus: nextAppointmentPaymentStatus,
                holdExpiresAt: null,
                qrToken,
              },
            });

            if (updatedAppointment.count !== 1) {
              throw new AppError("BOOK_NOW_APPOINTMENT_UPDATE_CONFLICT", 409);
            }
          }

          // =====================================================
          // 13. CREATE WALLET PAYMENT RECORD
          // =====================================================

          // =====================================================
          // 14. RETURN RESULT
          // =====================================================

          return {
            purchaseId: purchase.id,
            paymentId: payment.id,
            paymentStatus: nextPurchaseStatus,
            amountPaid: Number(paymentAmount),
            remainingAmount: isDeposit
              ? Number(purchase.amount.minus(paymentAmount))
              : 0,
            ...walletResult,
          };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 10000,
          timeout: 15000,
        },
      );
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

  throw new AppError("GROUP_PURCHASE_PAYMENT_RETRY_FAILED", 409);
};

const payAppointmentRemainingWithWallet = async (
  customerId: string,
  appointmentId: string,
  payload: { useBonus: boolean },
) => {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const now = new Date();

          // =====================================================
          // 1. LOCK APPOINTMENT
          // =====================================================

          const locked = await tx.$queryRaw<Array<{ id: string }>>`
            SELECT "id"
            FROM "Appointment"
            WHERE "id" = ${appointmentId}
            FOR UPDATE
          `;

          if (locked.length !== 1) {
            throw new AppError("APPOINTMENT_NOT_FOUND", 404);
          }

          // =====================================================
          // 2. LOAD APPOINTMENT
          // =====================================================

          const appointment = await tx.appointment.findUniqueOrThrow({
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

          // =====================================================
          // 3. CUSTOMER OWNERSHIP
          // =====================================================

          if (appointment.customerId !== customerId) {
            throw new AppError("FORBIDDEN_APPOINTMENT", 403);
          }

          // =====================================================
          // 4. NORMAL DEPOSIT ONLY
          // =====================================================

          if (appointment.groupPurchaseId !== null) {
            throw new AppError(
              "GROUP_PURCHASE_REQUIRES_SEPARATE_PAYMENT_FLOW",
              409,
            );
          }

          if (appointment.bookingMethod !== BookingMethod.DEPOSIT) {
            throw new AppError(
              "REMAINING_PAYMENT_ONLY_FOR_DEPOSIT_BOOKINGS",
              409,
            );
          }

          // =====================================================
          // 5. APPOINTMENT MUST BE CONFIRMED
          // =====================================================

          if (
            appointment.appointmentStatus !== AppointmentStatus.CONFIRMED ||
            appointment.paymentStatus !== PaymentStatus.PARTIALLY_PAID
          ) {
            throw new AppError(
              "APPOINTMENT_NOT_ELIGIBLE_FOR_REMAINING_PAYMENT",
              409,
            );
          }

          if (!appointment.qrVerifiedAt) {
            throw new AppError("APPOINTMENT_QR_VERIFICATION_REQUIRED", 409);
          }

          // =====================================================
          // 6. VALIDATE REMAINING AMOUNT
          // =====================================================

          const depositAmount = appointment.depositAmount;

          if (!depositAmount || depositAmount.lte(0)) {
            throw new AppError("INVALID_DEPOSIT_AMOUNT", 409);
          }

          const calculatedRemaining = appointment.price.minus(depositAmount);

          const remainingAmount =
            appointment.remainingAmount ?? calculatedRemaining;

          if (
            !remainingAmount.isFinite() ||
            remainingAmount.lte(0) ||
            !remainingAmount.equals(calculatedRemaining)
          ) {
            throw new AppError("INVALID_REMAINING_AMOUNT", 409);
          }

          if (appointment.currency !== "HKD") {
            throw new AppError("UNSUPPORTED_CURRENCY", 409);
          }

          // =====================================================
          // 7. CHECK EXISTING REMAINING PAYMENTS
          // =====================================================

          const existingPayments = await tx.payment.findMany({
            where: {
              appointmentId,
              purpose: PaymentPurpose.APPOINTMENT_REMAINING,
              status: {
                in: [
                  PaymentStatus.PENDING,
                  PaymentStatus.PAID,
                  PaymentStatus.PARTIALLY_REFUNDED,
                ],
              },
            },
            select: {
              id: true,
              provider: true,
              status: true,
            },
          });

          if (
            existingPayments.some(
              (payment) =>
                payment.status === PaymentStatus.PAID ||
                payment.status === PaymentStatus.PARTIALLY_REFUNDED,
            )
          ) {
            throw new AppError("REMAINING_PAYMENT_ALREADY_COMPLETED", 409);
          }

          // A pending Stripe payment must be resolved or
          // safely cancelled before Wallet settlement.
          if (
            existingPayments.some(
              (payment) =>
                payment.provider === PaymentProvider.STRIPE &&
                payment.status === PaymentStatus.PENDING,
            )
          ) {
            throw new AppError("STRIPE_REMAINING_PAYMENT_PENDING", 409);
          }

          if (
            existingPayments.some(
              (payment) => payment.status === PaymentStatus.PENDING,
            )
          ) {
            throw new AppError("REMAINING_PAYMENT_ATTEMPT_PENDING", 409);
          }

          // =====================================================
          // 8. CREATE PAYMENT RECORD
          // =====================================================

          const payment = await tx.payment.create({
            data: {
              customerId,
              appointmentId,
              purpose: PaymentPurpose.APPOINTMENT_REMAINING,
              provider: PaymentProvider.WALLET,
              amount: remainingAmount,
              currency: appointment.currency,
              status: PaymentStatus.PENDING,
            },
          });

          // =====================================================
          // 9. ATOMIC WALLET DEDUCTION
          // =====================================================

          const walletResult = await deductWalletBalance(
            tx,
            customerId,
            remainingAmount,
            payload.useBonus,
            "APPOINTMENT_PAYMENT",
            payment.id,
          );

          // =====================================================
          // 10. GUARDED APPOINTMENT SETTLEMENT
          // =====================================================

          const updated = await tx.appointment.updateMany({
            where: {
              id: appointmentId,
              customerId,
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

          if (updated.count !== 1) {
            throw new AppError("REMAINING_PAYMENT_CONFLICT", 409);
          }

          // =====================================================
          // 11. MARK PAYMENT PAID
          // =====================================================

          await tx.payment.update({
            where: {
              id: payment.id,
            },
            data: {
              status: PaymentStatus.PAID,
              paidAt: now,
            },
          });

          // =====================================================
          // 12. MULTILINGUAL NOTIFICATION
          // =====================================================

          const translations = notificationTemplates.REMAINING_PAYMENT_RECEIVED(
            Number(remainingAmount),
            appointment.currency,
          );

          await notificationService.createNotification(
            {
              appointmentId,
              userId: customerId,
              type: "REMAINING_PAYMENT_RECEIVED",
              title: translations.en!.title!,
              message: translations.en!.message!,
              translations,
            },
            tx,
          );

          // =====================================================
          // 13. AUDIT LOG
          // =====================================================

          await auditLogService.createAuditLog(
            {
              userId: customerId,
              action: "REMAINING_PAYMENT_RECORDED",
              entityType: "APPOINTMENT",
              entityId: appointmentId,
              metadata: {
                paymentId: payment.id,
                provider: PaymentProvider.WALLET,
                bookingMethod: appointment.bookingMethod,
                previousPaymentStatus: PaymentStatus.PARTIALLY_PAID,
                newPaymentStatus: PaymentStatus.PAID,
                totalPrice: Number(appointment.price),
                depositAmount: Number(depositAmount),
                remainingAmount: Number(remainingAmount),
                paidBalanceUsed: walletResult.paidBalanceUsed,
                bonusBalanceUsed: walletResult.bonusBalanceUsed,
              },
            },
            tx,
          );

          // =====================================================
          // 14. RESPONSE
          // =====================================================

          return {
            appointmentId,
            paymentId: payment.id,
            bookingMethod: appointment.bookingMethod,
            appointmentStatus: appointment.appointmentStatus,
            paymentStatus: PaymentStatus.PAID,
            amountPaid: Number(remainingAmount),
            currency: appointment.currency,
            ...walletResult,
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

  throw new AppError("WALLET_REMAINING_PAYMENT_RETRY_FAILED", 409);
};

const payGroupPurchaseRemainingWithWallet = async (
  customerId: string,
  purchaseId: string,
  payload: { useBonus: boolean },
) => {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          // =====================================================
          // 1. LOCK GROUP PURCHASE
          // =====================================================

          const locked = await tx.$queryRaw<Array<{ id: string }>>`
            SELECT "id"
            FROM "GroupPurchase"
            WHERE "id" = ${purchaseId}
            FOR UPDATE
          `;

          if (locked.length !== 1) {
            throw new AppError("GROUP_PURCHASE_NOT_FOUND", 404);
          }

          // =====================================================
          // 2. FETCH GROUP PURCHASE
          // =====================================================

          const purchase = await tx.groupPurchase.findUniqueOrThrow({
            where: {
              id: purchaseId,
            },
            include: {
              appointments: true,
              payments: true,
            },
          });

          // =====================================================
          // 3. CUSTOMER OWNERSHIP
          // =====================================================

          if (purchase.customerId !== customerId) {
            throw new AppError("FORBIDDEN_GROUP_PURCHASE", 403);
          }

          // =====================================================
          // 4. DEPOSIT BOOKING ONLY
          // =====================================================

          if (purchase.bookingMethod !== BookingMethod.DEPOSIT) {
            throw new AppError("REMAINING_PAYMENT_ONLY_FOR_DEPOSIT", 409);
          }

          if (purchase.paymentStatus !== PaymentStatus.PARTIALLY_PAID) {
            throw new AppError(
              "GROUP_PURCHASE_NOT_ELIGIBLE_FOR_REMAINING_PAYMENT",
              409,
            );
          }

          // =====================================================
          // 5. VERIFY LINKED APPOINTMENT
          // =====================================================

          if (purchase.appointments.length !== 1) {
            throw new AppError("INVALID_GROUP_PURCHASE_APPOINTMENT_STATE", 409);
          }

          const appointment = purchase.appointments[0];

          if (
            appointment.customerId !== customerId ||
            appointment.groupPurchaseId !== purchaseId ||
            appointment.bookingMethod !== BookingMethod.DEPOSIT ||
            appointment.appointmentStatus !== AppointmentStatus.CONFIRMED ||
            appointment.paymentStatus !== PaymentStatus.PARTIALLY_PAID ||
            !appointment.qrVerifiedAt
          ) {
            throw new AppError("APPOINTMENT_QR_VERIFICATION_REQUIRED", 409);
          }

          // =====================================================
          // 6. CALCULATE PURCHASE-LEVEL REMAINING AMOUNT
          // =====================================================

          const totalAmount = new Prisma.Decimal(purchase.amount);

          const depositAmount = new Prisma.Decimal(purchase.depositAmount ?? 0);

          const remainingAmount = totalAmount.minus(depositAmount);

          if (
            totalAmount.lte(0) ||
            depositAmount.lte(0) ||
            remainingAmount.lte(0)
          ) {
            throw new AppError("INVALID_GROUP_PURCHASE_REMAINING_AMOUNT", 409);
          }

          if (
            purchase.remainingAmount !== null &&
            purchase.remainingAmount !== undefined &&
            !new Prisma.Decimal(purchase.remainingAmount).equals(
              remainingAmount,
            )
          ) {
            throw new AppError("GROUP_PURCHASE_REMAINING_AMOUNT_MISMATCH", 409);
          }

          // =====================================================
          // 7. VERIFY INITIAL DEPOSIT PAYMENT
          // =====================================================

          const initialDepositPaid = purchase.payments.some(
            (payment) =>
              payment.purpose === PaymentPurpose.GROUP_PURCHASE &&
              payment.status === PaymentStatus.PAID &&
              new Prisma.Decimal(payment.amount).equals(depositAmount),
          );

          if (!initialDepositPaid) {
            throw new AppError("GROUP_PURCHASE_DEPOSIT_PAYMENT_NOT_FOUND", 409);
          }

          // =====================================================
          // 8. CHECK EXISTING REMAINING PAYMENTS
          // =====================================================

          const existingRemainingPayment = purchase.payments.find(
            (payment) =>
              payment.purpose === PaymentPurpose.GROUP_PURCHASE &&
              new Prisma.Decimal(payment.amount).equals(remainingAmount) &&
              (payment.status === PaymentStatus.PENDING ||
                payment.status === PaymentStatus.PAID ||
                payment.status === PaymentStatus.PARTIALLY_REFUNDED),
          );

          if (existingRemainingPayment) {
            throw new AppError(
              "GROUP_PURCHASE_REMAINING_PAYMENT_ALREADY_EXISTS",
              409,
            );
          }

          // =====================================================
          // 9. CREATE PENDING PAYMENT
          // =====================================================

          const payment = await tx.payment.create({
            data: {
              customerId,
              groupPurchaseId: purchaseId,
              appointmentId: appointment.id,
              purpose: PaymentPurpose.GROUP_PURCHASE,
              provider: PaymentProvider.WALLET,
              amount: remainingAmount,
              currency: "HKD",
              status: PaymentStatus.PENDING,
            },
          });

          // =====================================================
          // 10. DEDUCT WALLET BALANCE
          // =====================================================

          const walletResult = await deductWalletBalance(
            tx,
            customerId,
            remainingAmount,
            payload.useBonus,
            "GROUP_PURCHASE_PAYMENT",
            payment.id,
          );

          // =====================================================
          // 11. GUARDED GROUP PURCHASE UPDATE
          // =====================================================

          const updatedPurchase = await tx.groupPurchase.updateMany({
            where: {
              id: purchaseId,
              customerId,
              bookingMethod: BookingMethod.DEPOSIT,
              paymentStatus: PaymentStatus.PARTIALLY_PAID,
            },
            data: {
              paymentStatus: PaymentStatus.PAID,
            },
          });

          if (updatedPurchase.count !== 1) {
            throw new AppError(
              "GROUP_PURCHASE_REMAINING_PAYMENT_CONFLICT",
              409,
            );
          }

          // =====================================================
          // 12. GUARDED APPOINTMENT UPDATE
          // =====================================================

          const updatedAppointment = await tx.appointment.updateMany({
            where: {
              id: appointment.id,
              groupPurchaseId: purchaseId,
              customerId,
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
              "GROUP_PURCHASE_APPOINTMENT_PAYMENT_CONFLICT",
              409,
            );
          }

          // =====================================================
          // 13. MARK PAYMENT AS PAID
          // =====================================================

          const paidPayment = await tx.payment.update({
            where: {
              id: payment.id,
            },
            data: {
              status: PaymentStatus.PAID,
              paidAt: new Date(),
            },
          });

          // =====================================================
          // 14. NOTIFICATION
          // =====================================================

          const translations = notificationTemplates.REMAINING_PAYMENT_RECEIVED(
            Number(remainingAmount),
            "HKD",
          );

          await notificationService.createNotification(
            {
              appointmentId: appointment.id,
              userId: customerId,
              type: "REMAINING_PAYMENT_RECEIVED",
              title: translations.en!.title!,
              message: translations.en!.message!,
              translations,
            },
            tx,
          );

          // =====================================================
          // 15. AUDIT LOG
          // =====================================================

          await auditLogService.createAuditLog(
            {
              userId: customerId,
              action: "GROUP_PURCHASE_REMAINING_PAYMENT_RECORDED",
              entityType: "GROUP_PURCHASE",
              entityId: purchaseId,
              metadata: {
                paymentId: paidPayment.id,
                appointmentId: appointment.id,
                provider: PaymentProvider.WALLET,
                bookingMethod: BookingMethod.DEPOSIT,
                totalAmount: Number(totalAmount),
                depositAmount: Number(depositAmount),
                remainingAmount: Number(remainingAmount),
                paidBalanceUsed: walletResult.paidBalanceUsed,
                bonusBalanceUsed: walletResult.bonusBalanceUsed,
              },
            },
            tx,
          );

          // =====================================================
          // 16. RESPONSE
          // =====================================================

          return {
            purchaseId,
            appointmentId: appointment.id,
            paymentId: paidPayment.id,

            bookingMethod: BookingMethod.DEPOSIT,
            paymentStatus: PaymentStatus.PAID,
            appointmentStatus: AppointmentStatus.CONFIRMED,

            totalAmount: Number(totalAmount),
            depositAmount: Number(depositAmount),
            amountPaid: Number(remainingAmount),

            currency: "HKD",

            ...walletResult,
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

  throw new AppError("GROUP_PURCHASE_REMAINING_PAYMENT_RETRY_FAILED", 409);
};
export const walletService = {
  getMyWallet,
  getMyTransactions,
  createTopup,
  payAppointmentWithWallet,
  payGroupPurchaseWithWallet,
  payAppointmentRemainingWithWallet,
  payGroupPurchaseRemainingWithWallet,
};
