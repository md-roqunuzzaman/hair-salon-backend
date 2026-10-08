import {
  AppointmentStatus,
  BalanceType,
  PaymentProvider,
  PaymentPurpose,
  PaymentStatus,
  Prisma,
  PromotionStatus,
  WalletTopupStatus,
  WalletTransactionType,
} from "../../../../generated/prisma/client.js";
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

  const amount = payload.amount;

  // Promotion module not implemented yet.
  // Keep contract-compatible; later calculate from active eligible promotion.
  const now = new Date();

  const eligiblePromotion = await prisma.promotion.findFirst({
    where: {
      status: PromotionStatus.ACTIVE,

      startAt: {
        lte: now,
      },

      endAt: {
        gte: now,
      },

      minimumTopup: {
        lte: amount,
      },

      // Wallet top-up has no branch/service/package context.
      // Therefore only global promotions are eligible.
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

    orderBy: [
      {
        bonusAmount: "desc",
      },
      {
        minimumTopup: "desc",
      },
      {
        createdAt: "asc",
      },
    ],

    select: {
      id: true,
      bonusAmount: true,
    },
  });

  const potentialBonus = eligiblePromotion
    ? Number(eligiblePromotion.bonusAmount)
    : 0;
  const topup = await prisma.walletTopup.create({
    data: {
      walletId: wallet.id,
      amount,
      potentialBonus,
      status: WalletTopupStatus.PENDING,
    },
  });

  const payment = await prisma.payment.create({
    data: {
      customerId,

      walletTopupId: topup.id,

      purpose: PaymentPurpose.WALLET_TOP_UP,

      amount,
      currency: "HKD",

      status: PaymentStatus.PENDING,
    },
  });

  try {
    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount: Math.round(amount * 100),

        currency: "hkd",

        metadata: {
          paymentId: payment.id,
          topupId: topup.id,
          walletId: wallet.id,
          customerId,
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

    return {
      topupId: topup.id,
      amount,
      potentialBonus,
      stripeClientSecret: paymentIntent.client_secret,
    };
  } catch {
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

          // ==========================================
          // 3. PAYMENT STATUS
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

          // ==========================================
          // 4. HOLD EXPIRY
          // ==========================================

          const now = new Date();

          if (appointment.holdExpiresAt && appointment.holdExpiresAt <= now) {
            throw new AppError("SLOT_HOLD_EXPIRED", 409);
          }

          // ==========================================
          // 5. CHECK EXISTING PAYMENTS
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

          // Prevent paying by wallet while a Stripe
          // payment may still complete asynchronously.
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
          // 6. ATOMIC WALLET DEDUCTION
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
          // 7. GUARDED APPOINTMENT UPDATE
          // ==========================================

          const updated = await tx.appointment.updateMany({
            where: {
              id: appointment.id,
              customerId,
              appointmentStatus: AppointmentStatus.PENDING_PAYMENT,
              paymentStatus: appointment.paymentStatus,
              ...(appointment.holdExpiresAt
                ? { holdExpiresAt: { gt: now } }
                : {}),
            },
            data: {
              paymentStatus: PaymentStatus.PAID,
              appointmentStatus: AppointmentStatus.CONFIRMED,
              holdExpiresAt: null,
            },
          });

          if (updated.count !== 1) {
            throw new AppError("APPOINTMENT_PAYMENT_CONFLICT", 409);
          }

          // ==========================================
          // 8. CREATE WALLET PAYMENT RECORD
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
              paidAt: new Date(),
            },
          });

          // ==========================================
          // 9. BOOKING CONFIRMED NOTIFICATION
          // ==========================================

          await notificationService.createNotification(
            {
              userId: customerId,
              type: "BOOKING_CONFIRMED",
              title: "Booking confirmed",
              message: "Your appointment has been confirmed successfully.",
            },
            tx,
          );

          // ==========================================
          // 10. RESPONSE
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

          // 1. Find purchase
          const purchase = await tx.groupPurchase.findUnique({
            where: { id: purchaseId },
            select: {
              id: true,
              customerId: true,
              packageId: true,
              quantity: true,
              amount: true,
              paymentStatus: true,
              reservationExpiresAt: true,
            },
          });

          if (!purchase) {
            throw new AppError("GROUP_PURCHASE_NOT_FOUND", 404);
          }

          // 2. Ownership
          if (purchase.customerId !== customerId) {
            throw new AppError("FORBIDDEN_GROUP_PURCHASE", 403);
          }

          // 3. Status validation
          if (purchase.paymentStatus === PaymentStatus.PAID) {
            throw new AppError("PAYMENT_ALREADY_COMPLETED", 409);
          }

          if (purchase.paymentStatus !== PaymentStatus.PENDING) {
            throw new AppError("GROUP_PURCHASE_NOT_PAYABLE", 409);
          }

          // 4. Reservation expiry
          if (
            !purchase.reservationExpiresAt ||
            purchase.reservationExpiresAt <= now
          ) {
            throw new AppError("GROUP_PURCHASE_RESERVATION_EXPIRED", 409);
          }

          // 5. Check existing payments
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

          if (
            existingPayments.some(
              (payment) =>
                payment.provider === PaymentProvider.STRIPE &&
                payment.status === PaymentStatus.PENDING,
            )
          ) {
            throw new AppError("STRIPE_PAYMENT_ALREADY_PENDING", 409);
          }

          // 6. Deduct wallet
          const walletResult = await deductWalletBalance(
            tx,
            customerId,
            purchase.amount,
            payload.useBonus,
            "GROUP_PURCHASE_PAYMENT",
            purchase.id,
          );

          // 7. Finalize purchase (guarded)
          const updatedPurchase = await tx.groupPurchase.updateMany({
            where: {
              id: purchase.id,
              customerId,
              paymentStatus: PaymentStatus.PENDING,
              reservationExpiresAt: { gt: now },
            },
            data: {
              paymentStatus: PaymentStatus.PAID,
              purchasedAt: now,
            },
          });

          if (updatedPurchase.count !== 1) {
            throw new AppError("GROUP_PURCHASE_PAYMENT_CONFLICT", 409);
          }

          // 8. Transfer reserved capacity to sold
          const updatedPackage = await tx.package.updateMany({
            where: {
              id: purchase.packageId,
              reservedQuantity: { gte: purchase.quantity },
            },
            data: {
              reservedQuantity: { decrement: purchase.quantity },
              soldQuantity: { increment: purchase.quantity },
            },
          });

          if (updatedPackage.count !== 1) {
            throw new AppError("GROUP_PURCHASE_CAPACITY_CONFLICT", 409);
          }

          // 9. Create Payment record
          const payment = await tx.payment.create({
            data: {
              customerId,
              groupPurchaseId: purchase.id,
              purpose: PaymentPurpose.GROUP_PURCHASE,
              provider: PaymentProvider.WALLET,
              amount: purchase.amount,
              currency: "HKD",
              status: PaymentStatus.PAID,
              paidAt: now,
            },
          });

          return {
            purchaseId: purchase.id,
            paymentId: payment.id,
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

  throw new AppError("GROUP_PURCHASE_PAYMENT_RETRY_FAILED", 409);
};
export const walletService = {
  getMyWallet,
  getMyTransactions,
  createTopup,
  payAppointmentWithWallet,
  payGroupPurchaseWithWallet,
};
