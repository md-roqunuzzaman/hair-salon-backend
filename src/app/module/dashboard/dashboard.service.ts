import {
  AppointmentStatus,
  BalanceType,
  BookingMethod,
  ListingStatus,
  PackageStatus,
  PackageType,
  PaymentPurpose,
  PaymentStatus,
  RefundStatus,
  Role,
  WalletTransactionType,
} from "../../../../generated/prisma/client.js";

import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../utils/app-error.js";

import { IDashboardQuery } from "./dashboard.interface.js";

const roundPercentage = (value: number) => {
  return Number(value.toFixed(2));
};

const getBrandDashboard = async (query: IDashboardQuery) => {
  // =====================================================
  // 1. DATE RANGE
  // =====================================================

  const appointmentDateFilter =
    query.from || query.to
      ? {
          ...(query.from && {
            gte: new Date(`${query.from}T00:00:00.000Z`),
          }),

          ...(query.to && {
            lte: new Date(`${query.to}T00:00:00.000Z`),
          }),
        }
      : undefined;

  /*
   * Financial / account events use actual timestamps.
   *
   * Business timezone = Hong Kong (+08:00)
   */
  const createdAtFilter =
    query.from || query.to
      ? {
          ...(query.from && {
            gte: new Date(`${query.from}T00:00:00+08:00`),
          }),

          ...(query.to && {
            lte: new Date(`${query.to}T23:59:59.999+08:00`),
          }),
        }
      : undefined;

  // =====================================================
  // 2. OVERVIEW + APPOINTMENT COUNTS
  // =====================================================

  const [
    totalBranches,
    totalStaff,
    totalCustomers,
    newCustomers,

    totalAppointments,

    payNowAppointments,
    reserveNowAppointments,

    pendingPaymentAppointments,
    reservedAppointments,
    confirmedAppointments,
    completedAppointments,
    cancelledAppointments,
    noShowAppointments,
    expiredAppointments,

    completedReserveNowAppointments,
  ] = await prisma.$transaction([
    // ---------------------------------------------------
    // Overall counts
    // ---------------------------------------------------

    prisma.branch.count(),

    prisma.staff.count(),

    prisma.user.count({
      where: {
        role: Role.CUSTOMER,
      },
    }),

    // ---------------------------------------------------
    // New customers in selected period
    // ---------------------------------------------------

    prisma.user.count({
      where: {
        role: Role.CUSTOMER,

        ...(createdAtFilter && {
          createdAt: createdAtFilter,
        }),
      },
    }),

    // ---------------------------------------------------
    // Total appointments
    // ---------------------------------------------------

    prisma.appointment.count({
      where: {
        ...(appointmentDateFilter && {
          date: appointmentDateFilter,
        }),
      },
    }),

    // ---------------------------------------------------
    // Booking method
    // ---------------------------------------------------

    prisma.appointment.count({
      where: {
        bookingMethod: BookingMethod.PAY_NOW,

        ...(appointmentDateFilter && {
          date: appointmentDateFilter,
        }),
      },
    }),

    prisma.appointment.count({
      where: {
        bookingMethod: BookingMethod.RESERVE_NOW,

        ...(appointmentDateFilter && {
          date: appointmentDateFilter,
        }),
      },
    }),

    // ---------------------------------------------------
    // Status counts
    // ---------------------------------------------------

    prisma.appointment.count({
      where: {
        appointmentStatus: AppointmentStatus.PENDING_PAYMENT,

        ...(appointmentDateFilter && {
          date: appointmentDateFilter,
        }),
      },
    }),

    prisma.appointment.count({
      where: {
        appointmentStatus: AppointmentStatus.RESERVED,

        ...(appointmentDateFilter && {
          date: appointmentDateFilter,
        }),
      },
    }),

    prisma.appointment.count({
      where: {
        appointmentStatus: AppointmentStatus.CONFIRMED,

        ...(appointmentDateFilter && {
          date: appointmentDateFilter,
        }),
      },
    }),

    prisma.appointment.count({
      where: {
        appointmentStatus: AppointmentStatus.COMPLETED,

        ...(appointmentDateFilter && {
          date: appointmentDateFilter,
        }),
      },
    }),

    prisma.appointment.count({
      where: {
        appointmentStatus: AppointmentStatus.CANCELLED,

        ...(appointmentDateFilter && {
          date: appointmentDateFilter,
        }),
      },
    }),

    prisma.appointment.count({
      where: {
        appointmentStatus: AppointmentStatus.NO_SHOW,

        ...(appointmentDateFilter && {
          date: appointmentDateFilter,
        }),
      },
    }),

    prisma.appointment.count({
      where: {
        appointmentStatus: AppointmentStatus.EXPIRED,

        ...(appointmentDateFilter && {
          date: appointmentDateFilter,
        }),
      },
    }),

    // ---------------------------------------------------
    // Completed Reserve Now appointments
    // ---------------------------------------------------

    prisma.appointment.count({
      where: {
        bookingMethod: BookingMethod.RESERVE_NOW,

        appointmentStatus: AppointmentStatus.COMPLETED,

        ...(appointmentDateFilter && {
          date: appointmentDateFilter,
        }),
      },
    }),
  ]);

  // =====================================================
  // 3. COMPLETED SERVICE VALUE
  // =====================================================

  const completedAppointmentValue = await prisma.appointment.aggregate({
    where: {
      appointmentStatus: AppointmentStatus.COMPLETED,

      ...(appointmentDateFilter && {
        date: appointmentDateFilter,
      }),
    },

    _sum: {
      price: true,
    },

    _avg: {
      price: true,
    },
  });

  const completedServiceValue = Number(
    completedAppointmentValue._sum.price ?? 0,
  );

  const averageBookingValue = Number(
    Number(completedAppointmentValue._avg.price ?? 0).toFixed(2),
  );

  // =====================================================
  // 4. STRIPE APPOINTMENT PAYMENTS
  // =====================================================

  const stripePaymentSummary = await prisma.payment.aggregate({
    where: {
      purpose: PaymentPurpose.APPOINTMENT,

      status: {
        in: [
          PaymentStatus.PAID,
          PaymentStatus.PARTIALLY_REFUNDED,
          PaymentStatus.REFUNDED,
        ],
      },

      ...(createdAtFilter && {
        createdAt: createdAtFilter,
      }),
    },

    _sum: {
      amount: true,
    },
  });

  const stripeTotal = Number(stripePaymentSummary._sum.amount ?? 0);

  // =====================================================
  // 5. WALLET APPOINTMENT PAYMENTS
  // =====================================================
  //
  // PAID balance = customer-funded money.
  // BONUS balance = promotional value.
  //
  // Keep separate.
  // =====================================================

  const [walletPaidSummary, walletBonusUsageSummary] = await Promise.all([
    prisma.walletTransaction.aggregate({
      where: {
        type: WalletTransactionType.APPOINTMENT_PAYMENT,

        balanceType: BalanceType.PAID,

        ...(createdAtFilter && {
          createdAt: createdAtFilter,
        }),
      },

      _sum: {
        amount: true,
      },
    }),

    prisma.walletTransaction.aggregate({
      where: {
        type: WalletTransactionType.APPOINTMENT_PAYMENT,

        balanceType: BalanceType.BONUS,

        ...(createdAtFilter && {
          createdAt: createdAtFilter,
        }),
      },

      _sum: {
        amount: true,
      },
    }),
  ]);

  const walletPaidTotal = Math.abs(Number(walletPaidSummary._sum.amount ?? 0));

  const walletBonusUsed = Math.abs(
    Number(walletBonusUsageSummary._sum.amount ?? 0),
  );

  // =====================================================
  // 6. REFUNDS
  // =====================================================

  const refundSummary = await prisma.refund.aggregate({
    where: {
      status: RefundStatus.SUCCEEDED,

      ...(createdAtFilter && {
        createdAt: createdAtFilter,
      }),
    },

    _sum: {
      amount: true,
    },
  });

  const refundTotal = Number(refundSummary._sum.amount ?? 0);

  // =====================================================
  // 7. COLLECTION KPIs
  // =====================================================

  const grossCollected = stripeTotal + walletPaidTotal;

  const netCollected = Math.max(0, grossCollected - refundTotal);

  // =====================================================
  // 8. WALLET PROGRAM
  // =====================================================

  const [walletTopupSummary, walletBonusSummary] = await Promise.all([
    prisma.walletTransaction.aggregate({
      where: {
        type: WalletTransactionType.TOP_UP,

        balanceType: BalanceType.PAID,

        ...(createdAtFilter && {
          createdAt: createdAtFilter,
        }),
      },

      _sum: {
        amount: true,
      },
    }),

    prisma.walletTransaction.aggregate({
      where: {
        type: WalletTransactionType.BONUS,

        balanceType: BalanceType.BONUS,

        ...(createdAtFilter && {
          createdAt: createdAtFilter,
        }),
      },

      _sum: {
        amount: true,
      },
    }),
  ]);

  const topupTotal = Number(walletTopupSummary._sum.amount ?? 0);

  const bonusIssued = Number(walletBonusSummary._sum.amount ?? 0);

  // =====================================================
  // 9. GROUP PURCHASE
  // =====================================================

  const activeGroupPurchasePackages = await prisma.package.count({
    where: {
      type: PackageType.GROUP_PURCHASE_PACKAGE,

      status: PackageStatus.ACTIVE,

      listingStatus: ListingStatus.LISTED,
    },
  });

  /*
   * Only PAID purchases count as sold.
   *
   * PENDING = reserved capacity only.
   */
  const groupPurchaseSummary = await prisma.groupPurchase.aggregate({
    where: {
      paymentStatus: PaymentStatus.PAID,

      ...(createdAtFilter && {
        createdAt: createdAtFilter,
      }),
    },

    _sum: {
      quantity: true,
      amount: true,
    },
  });

  const totalSold = Number(groupPurchaseSummary._sum.quantity ?? 0);

  const groupPurchaseSalesAmount = Number(
    groupPurchaseSummary._sum.amount ?? 0,
  );

  // =====================================================
  // 10. KPI CALCULATIONS
  // =====================================================

  const completionRate =
    totalAppointments === 0
      ? 0
      : roundPercentage((completedAppointments / totalAppointments) * 100);

  const cancellationRate =
    totalAppointments === 0
      ? 0
      : roundPercentage((cancelledAppointments / totalAppointments) * 100);

  const noShowRate =
    totalAppointments === 0
      ? 0
      : roundPercentage((noShowAppointments / totalAppointments) * 100);

  /*
   * Correct reservation conversion:
   *
   * completed RESERVE_NOW
   * ---------------------
   * total RESERVE_NOW
   */
  const reserveConversionRate =
    reserveNowAppointments === 0
      ? 0
      : roundPercentage(
          (completedReserveNowAppointments / reserveNowAppointments) * 100,
        );

  // =====================================================
  // 11. FINAL DTO
  // =====================================================

  return {
    period: {
      from: query.from ?? null,
      to: query.to ?? null,
    },

    overview: {
      totalBranches,
      totalStaff,
      totalCustomers,
      newCustomers,
    },

    appointments: {
      total: totalAppointments,

      payNow: payNowAppointments,

      reserveNow: reserveNowAppointments,

      pendingPayment: pendingPaymentAppointments,

      reserved: reservedAppointments,

      confirmed: confirmedAppointments,

      completed: completedAppointments,

      completedReserveNow: completedReserveNowAppointments,

      cancelled: cancelledAppointments,

      noShow: noShowAppointments,

      expired: expiredAppointments,
    },

    kpis: {
      completionRate,
      cancellationRate,
      noShowRate,
      reserveConversionRate,
      averageBookingValue,
      completedServiceValue,
    },

    payments: {
      stripeTotal,

      walletPaidTotal,

      walletBonusUsed,

      grossCollected,

      refundTotal,

      netCollected,

      currency: "HKD",
    },

    wallet: {
      topupTotal,
      bonusIssued,
      currency: "HKD",
    },

    groupPurchase: {
      activePackages: activeGroupPurchasePackages,

      totalSold,

      salesAmount: groupPurchaseSalesAmount,

      currency: "HKD",
    },
  };
};

const getBranchDashboard = async (
  branchId: string,
  userId: string,
  role: Role,
  query: IDashboardQuery,
) => {
  // =====================================================
  // 1. CHECK BRANCH EXISTS
  // =====================================================

  const branch = await prisma.branch.findUnique({
    where: {
      id: branchId,
    },

    select: {
      id: true,
      name: true,
      status: true,
    },
  });

  if (!branch) {
    throw new AppError("BRANCH_NOT_FOUND", 404);
  }

  // =====================================================
  // 2. BRANCH MANAGER SCOPE
  // =====================================================

  if (role === Role.BRANCH_MANAGER) {
    const assignment = await prisma.branchManagerBranch.findUnique({
      where: {
        userId_branchId: {
          userId,
          branchId,
        },
      },

      select: {
        userId: true,
      },
    });

    if (!assignment) {
      throw new AppError("FORBIDDEN_BRANCH_SCOPE", 403);
    }
  }

  // =====================================================
  // 3. DATE RANGE
  // =====================================================

  const appointmentDateFilter =
    query.from || query.to
      ? {
          ...(query.from && {
            gte: new Date(`${query.from}T00:00:00.000Z`),
          }),

          ...(query.to && {
            lte: new Date(`${query.to}T00:00:00.000Z`),
          }),
        }
      : undefined;

  const createdAtFilter =
    query.from || query.to
      ? {
          ...(query.from && {
            gte: new Date(`${query.from}T00:00:00+08:00`),
          }),

          ...(query.to && {
            lte: new Date(`${query.to}T23:59:59.999+08:00`),
          }),
        }
      : undefined;

  const appointmentWhere = {
    branchId,

    ...(appointmentDateFilter && {
      date: appointmentDateFilter,
    }),
  };

  // =====================================================
  // 4. APPOINTMENT + STAFF COUNTS
  // =====================================================

  const [
    totalAppointments,

    payNowAppointments,
    reserveNowAppointments,

    pendingPaymentAppointments,
    reservedAppointments,
    confirmedAppointments,
    completedAppointments,
    completedReserveNowAppointments,
    cancelledAppointments,
    noShowAppointments,
    expiredAppointments,

    staffCount,
  ] = await prisma.$transaction([
    prisma.appointment.count({
      where: appointmentWhere,
    }),

    prisma.appointment.count({
      where: {
        ...appointmentWhere,
        bookingMethod: BookingMethod.PAY_NOW,
      },
    }),

    prisma.appointment.count({
      where: {
        ...appointmentWhere,
        bookingMethod: BookingMethod.RESERVE_NOW,
      },
    }),

    prisma.appointment.count({
      where: {
        ...appointmentWhere,
        appointmentStatus: AppointmentStatus.PENDING_PAYMENT,
      },
    }),

    prisma.appointment.count({
      where: {
        ...appointmentWhere,
        appointmentStatus: AppointmentStatus.RESERVED,
      },
    }),

    prisma.appointment.count({
      where: {
        ...appointmentWhere,
        appointmentStatus: AppointmentStatus.CONFIRMED,
      },
    }),

    prisma.appointment.count({
      where: {
        ...appointmentWhere,
        appointmentStatus: AppointmentStatus.COMPLETED,
      },
    }),

    prisma.appointment.count({
      where: {
        ...appointmentWhere,

        bookingMethod: BookingMethod.RESERVE_NOW,

        appointmentStatus: AppointmentStatus.COMPLETED,
      },
    }),

    prisma.appointment.count({
      where: {
        ...appointmentWhere,
        appointmentStatus: AppointmentStatus.CANCELLED,
      },
    }),

    prisma.appointment.count({
      where: {
        ...appointmentWhere,
        appointmentStatus: AppointmentStatus.NO_SHOW,
      },
    }),

    prisma.appointment.count({
      where: {
        ...appointmentWhere,
        appointmentStatus: AppointmentStatus.EXPIRED,
      },
    }),

    prisma.staffBranch.count({
      where: {
        branchId,
      },
    }),
  ]);

  // =====================================================
  // 5. COMPLETED SERVICE VALUE
  // =====================================================

  const completedValue = await prisma.appointment.aggregate({
    where: {
      ...appointmentWhere,

      appointmentStatus: AppointmentStatus.COMPLETED,
    },

    _sum: {
      price: true,
    },

    _avg: {
      price: true,
    },
  });

  const completedServiceValue = Number(completedValue._sum.price ?? 0);

  const averageBookingValue = Number(
    Number(completedValue._avg.price ?? 0).toFixed(2),
  );

  // =====================================================
  // 6. STRIPE PAYMENTS FOR THIS BRANCH
  // =====================================================

  const stripeSummary = await prisma.payment.aggregate({
    where: {
      purpose: PaymentPurpose.APPOINTMENT,

      appointment: {
        branchId,
      },

      status: {
        in: [
          PaymentStatus.PAID,
          PaymentStatus.PARTIALLY_REFUNDED,
          PaymentStatus.REFUNDED,
        ],
      },

      ...(createdAtFilter && {
        createdAt: createdAtFilter,
      }),
    },

    _sum: {
      amount: true,
    },
  });

  const stripeTotal = Number(stripeSummary._sum.amount ?? 0);

  // =====================================================
  // 7. WALLET APPOINTMENT PAYMENTS
  // =====================================================

  const [walletPaidSummary, walletBonusSummary] = await Promise.all([
    prisma.walletTransaction.aggregate({
      where: {
        type: WalletTransactionType.APPOINTMENT_PAYMENT,

        balanceType: BalanceType.PAID,

        referenceId: {
          in: (
            await prisma.appointment.findMany({
              where: appointmentWhere,
              select: {
                id: true,
              },
            })
          ).map((item) => item.id),
        },

        ...(createdAtFilter && {
          createdAt: createdAtFilter,
        }),
      },

      _sum: {
        amount: true,
      },
    }),

    prisma.walletTransaction.aggregate({
      where: {
        type: WalletTransactionType.APPOINTMENT_PAYMENT,

        balanceType: BalanceType.BONUS,

        referenceId: {
          in: (
            await prisma.appointment.findMany({
              where: appointmentWhere,
              select: {
                id: true,
              },
            })
          ).map((item) => item.id),
        },

        ...(createdAtFilter && {
          createdAt: createdAtFilter,
        }),
      },

      _sum: {
        amount: true,
      },
    }),
  ]);

  const walletPaidTotal = Math.abs(Number(walletPaidSummary._sum.amount ?? 0));

  const walletBonusUsed = Math.abs(Number(walletBonusSummary._sum.amount ?? 0));

  // =====================================================
  // 8. REFUNDS
  // =====================================================

  const refundSummary = await prisma.refund.aggregate({
    where: {
      status: RefundStatus.SUCCEEDED,

      payment: {
        appointment: {
          branchId,
        },
      },

      ...(createdAtFilter && {
        createdAt: createdAtFilter,
      }),
    },

    _sum: {
      amount: true,
    },
  });

  const refundTotal = Number(refundSummary._sum.amount ?? 0);

  const grossCollected = stripeTotal + walletPaidTotal;

  const netCollected = Math.max(0, grossCollected - refundTotal);

  // =====================================================
  // 9. KPI
  // =====================================================

  const completionRate =
    totalAppointments === 0
      ? 0
      : roundPercentage((completedAppointments / totalAppointments) * 100);

  const cancellationRate =
    totalAppointments === 0
      ? 0
      : roundPercentage((cancelledAppointments / totalAppointments) * 100);

  const noShowRate =
    totalAppointments === 0
      ? 0
      : roundPercentage((noShowAppointments / totalAppointments) * 100);

  const reserveConversionRate =
    reserveNowAppointments === 0
      ? 0
      : roundPercentage(
          (completedReserveNowAppointments / reserveNowAppointments) * 100,
        );

  // =====================================================
  // 10. RESPONSE
  // =====================================================

  return {
    period: {
      from: query.from ?? null,
      to: query.to ?? null,
    },

    branch: {
      id: branch.id,
      name: branch.name,
      status: branch.status,
    },

    overview: {
      staffCount,
      totalAppointments,
    },

    appointments: {
      total: totalAppointments,

      payNow: payNowAppointments,

      reserveNow: reserveNowAppointments,

      pendingPayment: pendingPaymentAppointments,

      reserved: reservedAppointments,

      confirmed: confirmedAppointments,

      completed: completedAppointments,

      completedReserveNow: completedReserveNowAppointments,

      cancelled: cancelledAppointments,

      noShow: noShowAppointments,

      expired: expiredAppointments,
    },

    kpis: {
      completionRate,
      cancellationRate,
      noShowRate,
      reserveConversionRate,
      averageBookingValue,
      completedServiceValue,
    },

    payments: {
      stripeTotal,
      walletPaidTotal,
      walletBonusUsed,
      grossCollected,
      refundTotal,
      netCollected,
      currency: "HKD",
    },
  };
};

export const dashboardService = {
  getBrandDashboard,
  getBranchDashboard,
};
