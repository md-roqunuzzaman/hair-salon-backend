import {
  AppointmentStatus,
  BalanceType,
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

const payAppointmentWithWallet = async (
  customerId: string,
  appointmentId: string,
  payload: IPayAppointmentWithWalletPayload,
): Promise<IPayAppointmentWithWalletResponse> => {
  return await prisma.$transaction(
    async (tx) => {
      // =================================================
      // 1. FIND APPOINTMENT
      // =================================================

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

      // =================================================
      // 2. OWNERSHIP
      // =================================================

      if (appointment.customerId !== customerId) {
        throw new AppError(
          "You are not allowed to pay for this appointment",
          403,
        );
      }

      // =================================================
      // 3. ALREADY PAID
      // =================================================

      if (
        appointment.paymentStatus === PaymentStatus.PAID ||
        appointment.appointmentStatus === AppointmentStatus.CONFIRMED ||
        appointment.appointmentStatus === AppointmentStatus.COMPLETED
      ) {
        throw new AppError("PAYMENT_ALREADY_COMPLETED", 409);
      }

      // =================================================
      // 4. MUST BE PENDING PAYMENT
      // =================================================

      if (appointment.appointmentStatus !== AppointmentStatus.PENDING_PAYMENT) {
        throw new AppError("INVALID_APPOINTMENT_STATUS", 409);
      }

      // =================================================
      // 5. HOLD MUST STILL BE VALID
      // =================================================

      if (
        appointment.holdExpiresAt &&
        appointment.holdExpiresAt.getTime() <= Date.now()
      ) {
        throw new AppError("SLOT_HOLD_EXPIRED", 409);
      }

      // =================================================
      // 6. GET WALLET
      // =================================================

      const wallet = await tx.wallet.findUnique({
        where: {
          customerId,
        },
      });

      if (!wallet) {
        throw new AppError("INSUFFICIENT_WALLET_BALANCE", 422);
      }

      const amount = Number(appointment.price);

      const paidBalance = Number(wallet.paidBalance);

      const bonusBalance = Number(wallet.bonusBalance);

      // =================================================
      // 7. CALCULATE USAGE
      // =================================================

      let bonusBalanceUsed = 0;
      let paidBalanceUsed = 0;

      if (payload.useBonus) {
        bonusBalanceUsed = Math.min(bonusBalance, amount);

        paidBalanceUsed = amount - bonusBalanceUsed;
      } else {
        paidBalanceUsed = amount;
      }

      // =================================================
      // 8. CHECK BALANCE
      // =================================================

      if (paidBalanceUsed > paidBalance) {
        throw new AppError("INSUFFICIENT_WALLET_BALANCE", 422);
      }

      // =================================================
      // 9. DEDUCT WALLET
      // =================================================

      const updatedWallet = await tx.wallet.update({
        where: {
          id: wallet.id,
        },

        data: {
          paidBalance: {
            decrement: paidBalanceUsed,
          },

          bonusBalance: {
            decrement: bonusBalanceUsed,
          },
        },
      });

      // =================================================
      // 10. PAID BALANCE LEDGER
      // =================================================

      if (paidBalanceUsed > 0) {
        await tx.walletTransaction.create({
          data: {
            walletId: wallet.id,

            type: WalletTransactionType.APPOINTMENT_PAYMENT,

            balanceType: BalanceType.PAID,

            amount: -paidBalanceUsed,

            referenceId: appointment.id,
          },
        });
      }

      // =================================================
      // 11. BONUS BALANCE LEDGER
      // =================================================

      if (bonusBalanceUsed > 0) {
        await tx.walletTransaction.create({
          data: {
            walletId: wallet.id,

            type: WalletTransactionType.APPOINTMENT_PAYMENT,

            balanceType: BalanceType.BONUS,

            amount: -bonusBalanceUsed,

            referenceId: appointment.id,
          },
        });
      }

      // =================================================
      // 12. APPOINTMENT -> PAID + CONFIRMED
      // =================================================

      await tx.appointment.update({
        where: {
          id: appointment.id,
        },

        data: {
          paymentStatus: PaymentStatus.PAID,

          appointmentStatus: AppointmentStatus.CONFIRMED,

          holdExpiresAt: null,
        },
      });

      // =================================================
      // 13. CREATE BOOKING CONFIRMED NOTIFICATION
      // =================================================

      await notificationService.createNotification(
        {
          userId: customerId,
          type: "BOOKING_CONFIRMED",
          title: "Booking confirmed",
          message: "Your appointment has been confirmed successfully.",
        },
        tx,
      );

      // =================================================
      // 14. RESPONSE
      // =================================================

      return {
        paymentStatus: "PAID" as const,

        paidBalanceUsed,

        bonusBalanceUsed,

        remainingPaidBalance: Number(updatedWallet.paidBalance),

        remainingBonusBalance: Number(updatedWallet.bonusBalance),
      };
    },

    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    },
  );
};

export const walletService = {
  getMyWallet,
  getMyTransactions,
  createTopup,
  payAppointmentWithWallet,
};
