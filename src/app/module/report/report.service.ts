import {
  AppointmentStatus,
  BookingMethod,
  PackageType,
  PaymentStatus,
  Prisma,
  Role,
} from "../../../../generated/prisma/client.js";

import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../utils/app-error.js";

import {
  IBookingConversionReportQuery,
  IGroupPurchaseReportResponse,
  IPackageReportResponse,
  IReportDateQuery,
  IServiceReportResponse,
  IStaffReportQuery,
  IStaffReportResponse,
} from "./report.interface.js";

const roundPercentage = (value: number) => Number(value.toFixed(2));

const getBranchReport = async (query: IReportDateQuery) => {
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

  const branches = await prisma.branch.findMany({
    orderBy: {
      name: "asc",
    },

    select: {
      id: true,
      name: true,
      status: true,

      staff: {
        select: {
          staffId: true,
        },
      },
    },
  });

  const items = await Promise.all(
    branches.map(async (branch) => {
      const baseWhere = {
        branchId: branch.id,

        ...(appointmentDateFilter && {
          date: appointmentDateFilter,
        }),
      };

      const [
        totalAppointments,

        payNow,
        reserveNow,

        confirmed,
        completed,
        cancelled,
        noShow,

        reserveCompleted,
        reserveNoShow,

        completedValue,
      ] = await Promise.all([
        prisma.appointment.count({
          where: baseWhere,
        }),

        prisma.appointment.count({
          where: {
            ...baseWhere,
            bookingMethod: BookingMethod.PAY_NOW,
          },
        }),

        prisma.appointment.count({
          where: {
            ...baseWhere,
            bookingMethod: BookingMethod.RESERVE_NOW,
          },
        }),

        prisma.appointment.count({
          where: {
            ...baseWhere,
            appointmentStatus: AppointmentStatus.CONFIRMED,
          },
        }),

        prisma.appointment.count({
          where: {
            ...baseWhere,
            appointmentStatus: AppointmentStatus.COMPLETED,
          },
        }),

        prisma.appointment.count({
          where: {
            ...baseWhere,
            appointmentStatus: AppointmentStatus.CANCELLED,
          },
        }),

        prisma.appointment.count({
          where: {
            ...baseWhere,
            appointmentStatus: AppointmentStatus.NO_SHOW,
          },
        }),

        prisma.appointment.count({
          where: {
            ...baseWhere,

            bookingMethod: BookingMethod.RESERVE_NOW,

            appointmentStatus: AppointmentStatus.COMPLETED,
          },
        }),

        prisma.appointment.count({
          where: {
            ...baseWhere,

            bookingMethod: BookingMethod.RESERVE_NOW,

            appointmentStatus: AppointmentStatus.NO_SHOW,
          },
        }),

        prisma.appointment.aggregate({
          where: {
            ...baseWhere,

            appointmentStatus: AppointmentStatus.COMPLETED,
          },

          _sum: {
            price: true,
          },
        }),
      ]);

      const completionRate =
        totalAppointments === 0
          ? 0
          : roundPercentage((completed / totalAppointments) * 100);

      const cancellationRate =
        totalAppointments === 0
          ? 0
          : roundPercentage((cancelled / totalAppointments) * 100);

      const noShowRate =
        totalAppointments === 0
          ? 0
          : roundPercentage((noShow / totalAppointments) * 100);

      const reserveConversionRate =
        reserveNow === 0
          ? 0
          : roundPercentage((reserveCompleted / reserveNow) * 100);

      const reserveNoShowRate =
        reserveNow === 0
          ? 0
          : roundPercentage((reserveNoShow / reserveNow) * 100);

      return {
        branchId: branch.id,
        branchName: branch.name,
        branchStatus: branch.status,

        staffCount: branch.staff.length,

        totalAppointments,

        payNow,
        reserveNow,

        confirmed,
        completed,
        cancelled,
        noShow,

        reserveCompleted,
        reserveNoShow,

        rates: {
          completionRate,
          cancellationRate,
          noShowRate,
          reserveConversionRate,
          reserveNoShowRate,
        },

        completedServiceValue: Number(completedValue._sum.price ?? 0),

        currency: "HKD",
      };
    }),
  );

  return {
    period: {
      from: query.from ?? null,
      to: query.to ?? null,
    },

    items,
  };
};

const getBookingConversionReport = async (
  query: IBookingConversionReportQuery,
  userId: string,
  role: Role,
) => {
  // =====================================================
  // 1. BASE FILTER
  // =====================================================

  const where: Prisma.AppointmentWhereInput = {};

  // =====================================================
  // 2. DATE FILTER
  // =====================================================

  if (query.from || query.to) {
    where.date = {
      ...(query.from && {
        gte: new Date(`${query.from}T00:00:00.000Z`),
      }),

      ...(query.to && {
        lte: new Date(`${query.to}T00:00:00.000Z`),
      }),
    };
  }

  // =====================================================
  // 3. NORMAL FILTERS
  // =====================================================

  if (query.staffId) {
    where.staffId = query.staffId;
  }

  if (query.serviceId) {
    where.serviceId = query.serviceId;
  }

  if (query.packageId) {
    where.packageId = query.packageId;
  }

  // =====================================================
  // 4. BRANCH AUTHORIZATION
  // =====================================================
  //
  // BRAND_OWNER:
  //   - can query one branch
  //   - or whole brand
  //
  // BRANCH_MANAGER:
  //   - can only query assigned branch(es)
  // =====================================================

  if (role === Role.BRAND_OWNER) {
    if (query.branchId) {
      const branch = await prisma.branch.findUnique({
        where: {
          id: query.branchId,
        },

        select: {
          id: true,
        },
      });

      if (!branch) {
        throw new AppError("BRANCH_NOT_FOUND", 404);
      }

      where.branchId = query.branchId;
    }
  }

  if (role === Role.BRANCH_MANAGER) {
    const assignments = await prisma.branchManagerBranch.findMany({
      where: {
        userId,
      },

      select: {
        branchId: true,
      },
    });

    const assignedBranchIds = assignments.map(
      (assignment) => assignment.branchId,
    );

    if (assignedBranchIds.length === 0) {
      throw new AppError("FORBIDDEN_BRANCH_SCOPE", 403);
    }

    if (query.branchId) {
      if (!assignedBranchIds.includes(query.branchId)) {
        throw new AppError("FORBIDDEN_BRANCH_SCOPE", 403);
      }

      where.branchId = query.branchId;
    } else {
      where.branchId = {
        in: assignedBranchIds,
      };
    }
  }

  // =====================================================
  // 5. ALL APPOINTMENT COUNTS
  // =====================================================

  const [
    totalAppointments,

    completedAppointments,
    cancelledAppointments,
    noShowAppointments,

    pendingPaymentAppointments,
    reservedAppointments,
    confirmedAppointments,
    expiredAppointments,

    payNowTotal,
    payNowCompleted,
    payNowCancelled,
    payNowNoShow,

    reserveNowTotal,
    reserveNowCompleted,
    reserveNowCancelled,
    reserveNowNoShow,
    reserveNowReserved,
    reserveNowConfirmed,
  ] = await Promise.all([
    prisma.appointment.count({
      where,
    }),

    prisma.appointment.count({
      where: {
        ...where,
        appointmentStatus: AppointmentStatus.COMPLETED,
      },
    }),

    prisma.appointment.count({
      where: {
        ...where,
        appointmentStatus: AppointmentStatus.CANCELLED,
      },
    }),

    prisma.appointment.count({
      where: {
        ...where,
        appointmentStatus: AppointmentStatus.NO_SHOW,
      },
    }),

    prisma.appointment.count({
      where: {
        ...where,
        appointmentStatus: AppointmentStatus.PENDING_PAYMENT,
      },
    }),

    prisma.appointment.count({
      where: {
        ...where,
        appointmentStatus: AppointmentStatus.RESERVED,
      },
    }),

    prisma.appointment.count({
      where: {
        ...where,
        appointmentStatus: AppointmentStatus.CONFIRMED,
      },
    }),

    prisma.appointment.count({
      where: {
        ...where,
        appointmentStatus: AppointmentStatus.EXPIRED,
      },
    }),

    prisma.appointment.count({
      where: {
        ...where,
        bookingMethod: BookingMethod.PAY_NOW,
      },
    }),

    prisma.appointment.count({
      where: {
        ...where,
        bookingMethod: BookingMethod.PAY_NOW,
        appointmentStatus: AppointmentStatus.COMPLETED,
      },
    }),

    prisma.appointment.count({
      where: {
        ...where,
        bookingMethod: BookingMethod.PAY_NOW,
        appointmentStatus: AppointmentStatus.CANCELLED,
      },
    }),

    prisma.appointment.count({
      where: {
        ...where,
        bookingMethod: BookingMethod.PAY_NOW,
        appointmentStatus: AppointmentStatus.NO_SHOW,
      },
    }),

    prisma.appointment.count({
      where: {
        ...where,
        bookingMethod: BookingMethod.RESERVE_NOW,
      },
    }),

    prisma.appointment.count({
      where: {
        ...where,
        bookingMethod: BookingMethod.RESERVE_NOW,
        appointmentStatus: AppointmentStatus.COMPLETED,
      },
    }),

    prisma.appointment.count({
      where: {
        ...where,
        bookingMethod: BookingMethod.RESERVE_NOW,
        appointmentStatus: AppointmentStatus.CANCELLED,
      },
    }),

    prisma.appointment.count({
      where: {
        ...where,
        bookingMethod: BookingMethod.RESERVE_NOW,
        appointmentStatus: AppointmentStatus.NO_SHOW,
      },
    }),

    prisma.appointment.count({
      where: {
        ...where,
        bookingMethod: BookingMethod.RESERVE_NOW,
        appointmentStatus: AppointmentStatus.RESERVED,
      },
    }),

    prisma.appointment.count({
      where: {
        ...where,
        bookingMethod: BookingMethod.RESERVE_NOW,
        appointmentStatus: AppointmentStatus.CONFIRMED,
      },
    }),
  ]);

  // =====================================================
  // 6. RESOLVED APPOINTMENTS
  // =====================================================
  //
  // For operational conversion, open/future appointments
  // should not distort final outcome rate.
  //
  // Resolved:
  // COMPLETED
  // CANCELLED
  // NO_SHOW
  // =====================================================

  const eligibleAppointments =
    completedAppointments + cancelledAppointments + noShowAppointments;

  const payNowResolved = payNowCompleted + payNowCancelled + payNowNoShow;

  const reserveNowResolved =
    reserveNowCompleted + reserveNowCancelled + reserveNowNoShow;

  // =====================================================
  // 7. RATES
  // =====================================================

  const conversionRate =
    eligibleAppointments === 0
      ? 0
      : roundPercentage((completedAppointments / eligibleAppointments) * 100);

  const payNowConversionRate =
    payNowResolved === 0
      ? 0
      : roundPercentage((payNowCompleted / payNowResolved) * 100);

  const payNowNoShowRate =
    payNowTotal === 0 ? 0 : roundPercentage((payNowNoShow / payNowTotal) * 100);

  /*
   * This directly answers:
   *
   * "Koto gula Reserve Now korar por No Show?"
   *
   * denominator = all Reserve Now bookings
   */
  const reserveNoShowRate =
    reserveNowTotal === 0
      ? 0
      : roundPercentage((reserveNowNoShow / reserveNowTotal) * 100);

  /*
   * Booking → actual service conversion.
   *
   * This is the same metric we've been showing
   * in the dashboard.
   */
  const reserveConversionRate =
    reserveNowTotal === 0
      ? 0
      : roundPercentage((reserveNowCompleted / reserveNowTotal) * 100);

  /*
   * Mature reporting metric:
   * only appointments that already reached
   * a final business outcome.
   */
  const resolvedReserveConversionRate =
    reserveNowResolved === 0
      ? 0
      : roundPercentage((reserveNowCompleted / reserveNowResolved) * 100);

  const resolvedReserveNoShowRate =
    reserveNowResolved === 0
      ? 0
      : roundPercentage((reserveNowNoShow / reserveNowResolved) * 100);

  const reserveCancellationRate =
    reserveNowTotal === 0
      ? 0
      : roundPercentage((reserveNowCancelled / reserveNowTotal) * 100);

  // =====================================================
  // 8. RETURN
  // =====================================================

  return {
    period: {
      from: query.from ?? null,
      to: query.to ?? null,
    },

    filters: {
      branchId: query.branchId ?? null,

      staffId: query.staffId ?? null,

      serviceId: query.serviceId ?? null,

      packageId: query.packageId ?? null,
    },

    overall: {
      totalAppointments,

      eligibleAppointments,

      completedAppointments,
      cancelledAppointments,
      noShowAppointments,

      pendingPaymentAppointments,
      reservedAppointments,
      confirmedAppointments,
      expiredAppointments,

      conversionRate,
    },

    payNow: {
      total: payNowTotal,

      resolved: payNowResolved,

      completed: payNowCompleted,

      cancelled: payNowCancelled,

      noShow: payNowNoShow,

      conversionRate: payNowConversionRate,

      noShowRate: payNowNoShowRate,
    },

    reserveNow: {
      total: reserveNowTotal,

      resolved: reserveNowResolved,

      completed: reserveNowCompleted,

      cancelled: reserveNowCancelled,

      noShow: reserveNowNoShow,

      stillReserved: reserveNowReserved,

      confirmed: reserveNowConfirmed,

      reserveConversionRate,

      reserveCancellationRate,

      reserveNoShowRate,

      resolvedConversionRate: resolvedReserveConversionRate,

      resolvedNoShowRate: resolvedReserveNoShowRate,
    },
  };
};

const getServiceReport = async (): Promise<IServiceReportResponse> => {
  // =====================================================
  // 1. FETCH SERVICE APPOINTMENT METRICS
  // =====================================================

  const [
    bookingGroups,
    completedGroups,
    cancelledGroups,
    noShowGroups,
    revenueGroups,
  ] = await Promise.all([
    // -----------------------------------------------------
    // Total bookings per service
    // -----------------------------------------------------
    prisma.appointment.groupBy({
      by: ["serviceId"],

      where: {
        serviceId: {
          not: null,
        },
      },

      _count: {
        _all: true,
      },
    }),

    // -----------------------------------------------------
    // Completed appointments per service
    // -----------------------------------------------------
    prisma.appointment.groupBy({
      by: ["serviceId"],

      where: {
        serviceId: {
          not: null,
        },

        appointmentStatus: AppointmentStatus.COMPLETED,
      },

      _count: {
        _all: true,
      },
    }),

    // -----------------------------------------------------
    // Cancelled appointments per service
    // -----------------------------------------------------
    prisma.appointment.groupBy({
      by: ["serviceId"],

      where: {
        serviceId: {
          not: null,
        },

        appointmentStatus: AppointmentStatus.CANCELLED,
      },

      _count: {
        _all: true,
      },
    }),

    // -----------------------------------------------------
    // No-show appointments per service
    // -----------------------------------------------------
    prisma.appointment.groupBy({
      by: ["serviceId"],

      where: {
        serviceId: {
          not: null,
        },

        appointmentStatus: AppointmentStatus.NO_SHOW,
      },

      _count: {
        _all: true,
      },
    }),

    // -----------------------------------------------------
    // Revenue from actually completed services only
    // -----------------------------------------------------
    prisma.appointment.groupBy({
      by: ["serviceId"],

      where: {
        serviceId: {
          not: null,
        },

        appointmentStatus: AppointmentStatus.COMPLETED,
      },

      _sum: {
        price: true,
      },
    }),
  ]);

  // =====================================================
  // 2. SERVICE IDS
  // =====================================================

  const serviceIds = bookingGroups
    .map((group) => group.serviceId)
    .filter((serviceId): serviceId is string => Boolean(serviceId));

  if (serviceIds.length === 0) {
    return {
      items: [],
    };
  }

  // =====================================================
  // 3. FETCH SERVICE NAMES
  // =====================================================

  const services = await prisma.service.findMany({
    where: {
      id: {
        in: serviceIds,
      },
    },

    select: {
      id: true,
      name: true,
    },
  });

  // =====================================================
  // 4. LOOKUP MAPS
  // =====================================================

  const serviceNameMap = new Map(
    services.map((service) => [service.id, service.name]),
  );

  const completedMap = new Map(
    completedGroups
      .filter(
        (
          group,
        ): group is typeof group & {
          serviceId: string;
        } => Boolean(group.serviceId),
      )
      .map((group) => [group.serviceId, group._count._all]),
  );

  const cancelledMap = new Map(
    cancelledGroups
      .filter(
        (
          group,
        ): group is typeof group & {
          serviceId: string;
        } => Boolean(group.serviceId),
      )
      .map((group) => [group.serviceId, group._count._all]),
  );

  const noShowMap = new Map(
    noShowGroups
      .filter(
        (
          group,
        ): group is typeof group & {
          serviceId: string;
        } => Boolean(group.serviceId),
      )
      .map((group) => [group.serviceId, group._count._all]),
  );

  const revenueMap = new Map(
    revenueGroups
      .filter(
        (
          group,
        ): group is typeof group & {
          serviceId: string;
        } => Boolean(group.serviceId),
      )
      .map((group) => [group.serviceId, Number(group._sum.price ?? 0)]),
  );

  // =====================================================
  // 5. RESPONSE DTO
  // =====================================================

  const items = bookingGroups
    .filter(
      (
        group,
      ): group is typeof group & {
        serviceId: string;
      } => Boolean(group.serviceId),
    )
    .map((group) => {
      const serviceId = group.serviceId;

      return {
        serviceId,

        serviceName: serviceNameMap.get(serviceId) ?? "Unknown Service",

        bookingCount: group._count._all,

        completedCount: completedMap.get(serviceId) ?? 0,

        cancelledCount: cancelledMap.get(serviceId) ?? 0,

        noShowCount: noShowMap.get(serviceId) ?? 0,

        revenue: revenueMap.get(serviceId) ?? 0,
      };
    });

  return {
    items,
  };
};

const getPackageReport = async (): Promise<IPackageReportResponse> => {
  // =====================================================
  // 1. FETCH PACKAGE APPOINTMENT METRICS
  // =====================================================

  const [
    bookingGroups,
    completedGroups,
    cancelledGroups,
    noShowGroups,
    revenueGroups,
  ] = await Promise.all([
    prisma.appointment.groupBy({
      by: ["packageId"],

      where: {
        packageId: {
          not: null,
        },
      },

      _count: {
        _all: true,
      },
    }),

    prisma.appointment.groupBy({
      by: ["packageId"],

      where: {
        packageId: {
          not: null,
        },

        appointmentStatus: AppointmentStatus.COMPLETED,
      },

      _count: {
        _all: true,
      },
    }),

    prisma.appointment.groupBy({
      by: ["packageId"],

      where: {
        packageId: {
          not: null,
        },

        appointmentStatus: AppointmentStatus.CANCELLED,
      },

      _count: {
        _all: true,
      },
    }),

    prisma.appointment.groupBy({
      by: ["packageId"],

      where: {
        packageId: {
          not: null,
        },

        appointmentStatus: AppointmentStatus.NO_SHOW,
      },

      _count: {
        _all: true,
      },
    }),

    prisma.appointment.groupBy({
      by: ["packageId"],

      where: {
        packageId: {
          not: null,
        },

        appointmentStatus: AppointmentStatus.COMPLETED,
      },

      _sum: {
        price: true,
      },
    }),
  ]);

  // =====================================================
  // 2. PACKAGE IDS
  // =====================================================

  const packageIds = bookingGroups
    .map((group) => group.packageId)
    .filter((packageId): packageId is string => Boolean(packageId));

  if (packageIds.length === 0) {
    return {
      items: [],
    };
  }

  // =====================================================
  // 3. FETCH PACKAGE NAMES
  // =====================================================

  const packages = await prisma.package.findMany({
    where: {
      id: {
        in: packageIds,
      },
    },

    select: {
      id: true,
      name: true,
    },
  });

  // =====================================================
  // 4. LOOKUP MAPS
  // =====================================================

  const packageNameMap = new Map(packages.map((pkg) => [pkg.id, pkg.name]));

  const completedMap = new Map(
    completedGroups
      .filter(
        (
          group,
        ): group is typeof group & {
          packageId: string;
        } => Boolean(group.packageId),
      )
      .map((group) => [group.packageId, group._count._all]),
  );

  const cancelledMap = new Map(
    cancelledGroups
      .filter(
        (
          group,
        ): group is typeof group & {
          packageId: string;
        } => Boolean(group.packageId),
      )
      .map((group) => [group.packageId, group._count._all]),
  );

  const noShowMap = new Map(
    noShowGroups
      .filter(
        (
          group,
        ): group is typeof group & {
          packageId: string;
        } => Boolean(group.packageId),
      )
      .map((group) => [group.packageId, group._count._all]),
  );

  const revenueMap = new Map(
    revenueGroups
      .filter(
        (
          group,
        ): group is typeof group & {
          packageId: string;
        } => Boolean(group.packageId),
      )
      .map((group) => [group.packageId, Number(group._sum.price ?? 0)]),
  );

  // =====================================================
  // 5. RESPONSE DTO
  // =====================================================

  const items = bookingGroups
    .filter(
      (
        group,
      ): group is typeof group & {
        packageId: string;
      } => Boolean(group.packageId),
    )
    .map((group) => {
      const packageId = group.packageId;

      return {
        packageId,

        packageName: packageNameMap.get(packageId) ?? "Unknown Package",

        bookingCount: group._count._all,

        completedCount: completedMap.get(packageId) ?? 0,

        cancelledCount: cancelledMap.get(packageId) ?? 0,

        noShowCount: noShowMap.get(packageId) ?? 0,

        revenue: revenueMap.get(packageId) ?? 0,
      };
    });

  return {
    items,
  };
};

const getGroupPurchaseReport =
  async (): Promise<IGroupPurchaseReportResponse> => {
    // =====================================================
    // 1. FETCH ALL GROUP PURCHASE PACKAGES
    // =====================================================

    const packages = await prisma.package.findMany({
      where: {
        type: PackageType.GROUP_PURCHASE_PACKAGE,
      },

      select: {
        id: true,
        name: true,
        capacity: true,
        soldQuantity: true,
        listingStatus: true,
      },

      orderBy: {
        createdAt: "desc",
      },
    });

    if (packages.length === 0) {
      return {
        items: [],
      };
    }

    // =====================================================
    // 2. PACKAGE IDS
    // =====================================================

    const packageIds = packages.map((pkg) => pkg.id);

    // =====================================================
    // 3. FETCH SUCCESSFULLY PAID PURCHASES
    // =====================================================

    const paidPurchases = await prisma.groupPurchase.findMany({
      where: {
        packageId: {
          in: packageIds,
        },

        paymentStatus: PaymentStatus.PAID,
      },

      select: {
        packageId: true,
        customerId: true,
        amount: true,
      },
    });

    // =====================================================
    // 4. BUILD SALES + CUSTOMER MAPS
    // =====================================================

    const salesAmountMap = new Map<string, number>();

    const uniqueCustomerMap = new Map<string, Set<string>>();

    for (const purchase of paidPurchases) {
      const currentSales = salesAmountMap.get(purchase.packageId) ?? 0;

      salesAmountMap.set(
        purchase.packageId,
        currentSales + Number(purchase.amount),
      );

      if (!uniqueCustomerMap.has(purchase.packageId)) {
        uniqueCustomerMap.set(purchase.packageId, new Set<string>());
      }

      uniqueCustomerMap.get(purchase.packageId)!.add(purchase.customerId);
    }

    // =====================================================
    // 5. RESPONSE DTO
    // =====================================================

    const items = packages.map((pkg) => {
      const capacity = pkg.capacity ?? 0;

      const soldQuantity = pkg.soldQuantity;

      const remainingQuantity = Math.max(capacity - soldQuantity, 0);

      return {
        packageId: pkg.id,

        name: pkg.name,

        capacity,

        soldQuantity,

        remainingQuantity,

        uniqueCustomers: uniqueCustomerMap.get(pkg.id)?.size ?? 0,

        salesAmount: salesAmountMap.get(pkg.id) ?? 0,

        listingStatus: pkg.listingStatus,

        soldOut: capacity > 0 && soldQuantity >= capacity,
      };
    });

    return {
      items,
    };
  };

const getStaffReport = async (
  userId: string,
  role: Role,
  query: IStaffReportQuery,
): Promise<IStaffReportResponse> => {
  // =====================================================
  // 1. RESOLVE BRANCH SCOPE
  // =====================================================

  let allowedBranchIds: string[] | undefined;

  if (role === Role.BRANCH_MANAGER) {
    const managerBranches = await prisma.branchManagerBranch.findMany({
      where: {
        userId,
      },

      select: {
        branchId: true,
      },
    });

    allowedBranchIds = managerBranches.map((item) => item.branchId);

    if (query.branchId) {
      if (!allowedBranchIds.includes(query.branchId)) {
        throw new AppError(
          "You are not allowed to access this branch report",
          403,
        );
      }

      allowedBranchIds = [query.branchId];
    }
  } else if (role === Role.BRAND_OWNER) {
    if (query.branchId) {
      allowedBranchIds = [query.branchId];
    }
  }

  // =====================================================
  // 2. FETCH STAFF IN SCOPE
  // =====================================================

  const staff = await prisma.staff.findMany({
    where: allowedBranchIds
      ? {
          branches: {
            some: {
              branchId: {
                in: allowedBranchIds,
              },
            },
          },
        }
      : {},

    select: {
      id: true,
      name: true,
    },

    orderBy: {
      name: "asc",
    },
  });

  if (staff.length === 0) {
    return {
      items: [],
    };
  }

  const staffIds = staff.map((item) => item.id);

  // =====================================================
  // 3. APPOINTMENT FILTER
  // =====================================================

  const appointmentBaseWhere = {
    staffId: {
      in: staffIds,
    },

    ...(allowedBranchIds
      ? {
          branchId: {
            in: allowedBranchIds,
          },
        }
      : {}),
  };

  // =====================================================
  // 4. AGGREGATE APPOINTMENTS
  // =====================================================

  const [assignedGroups, completedGroups, cancelledGroups, noShowGroups] =
    await Promise.all([
      prisma.appointment.groupBy({
        by: ["staffId"],

        where: appointmentBaseWhere,

        _count: {
          _all: true,
        },
      }),

      prisma.appointment.groupBy({
        by: ["staffId"],

        where: {
          ...appointmentBaseWhere,
          appointmentStatus: AppointmentStatus.COMPLETED,
        },

        _count: {
          _all: true,
        },
      }),

      prisma.appointment.groupBy({
        by: ["staffId"],

        where: {
          ...appointmentBaseWhere,
          appointmentStatus: AppointmentStatus.CANCELLED,
        },

        _count: {
          _all: true,
        },
      }),

      prisma.appointment.groupBy({
        by: ["staffId"],

        where: {
          ...appointmentBaseWhere,
          appointmentStatus: AppointmentStatus.NO_SHOW,
        },

        _count: {
          _all: true,
        },
      }),
    ]);

  // =====================================================
  // 5. AVERAGE RATINGS
  // =====================================================

  const ratingGroups = await prisma.review.groupBy({
    by: ["staffId"],

    where: {
      staffId: {
        in: staffIds,
      },

      ...(allowedBranchIds
        ? {
            branchId: {
              in: allowedBranchIds,
            },
          }
        : {}),
    },

    _avg: {
      rating: true,
    },
  });

  // =====================================================
  // 6. LOOKUP MAPS
  // =====================================================

  const assignedMap = new Map(
    assignedGroups.map((group) => [group.staffId, group._count._all]),
  );

  const completedMap = new Map(
    completedGroups.map((group) => [group.staffId, group._count._all]),
  );

  const cancelledMap = new Map(
    cancelledGroups.map((group) => [group.staffId, group._count._all]),
  );

  const noShowMap = new Map(
    noShowGroups.map((group) => [group.staffId, group._count._all]),
  );

  const ratingMap = new Map(
    ratingGroups.map((group) => [
      group.staffId,
      Number(group._avg.rating ?? 0),
    ]),
  );

  // =====================================================
  // 7. RESPONSE DTO
  // =====================================================

  return {
    items: staff.map((item) => ({
      staffId: item.id,

      name: item.name,

      assignedAppointments: assignedMap.get(item.id) ?? 0,

      completedAppointments: completedMap.get(item.id) ?? 0,

      cancelled: cancelledMap.get(item.id) ?? 0,

      noShow: noShowMap.get(item.id) ?? 0,

      averageRating: Number((ratingMap.get(item.id) ?? 0).toFixed(2)),
    })),
  };
};

export const reportService = {
  getBranchReport,
  getBookingConversionReport,
  getServiceReport,
  getPackageReport,
  getGroupPurchaseReport,
  getStaffReport,
};
