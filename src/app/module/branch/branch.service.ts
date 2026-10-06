import {
  BranchStatus,
  Prisma,
  Role,
  UserStatus,
} from "../../../../generated/prisma/client.js";

import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../utils/app-error.js";
import { auditLogService } from "../auditLog/auditLog.service.js";

import {
  ICreateBranchPayload,
  ICustomerOperationalSearchQuery,
  ICustomerOperationalSearchResponse,
  IUpdateBookingPolicyPayload,
  IUpdateBranchPayload,
  IUpdateBranchStatusPayload,
  IUpdateBusinessHoursPayload,
} from "./branch.interface.js";

// =====================================================
// CREATE BRANCH
// =====================================================

const createBranch = async (payload: ICreateBranchPayload) => {
  const existingBranch = await prisma.branch.findFirst({
    where: {
      name: {
        equals: payload.name.trim(),
        mode: "insensitive",
      },
    },
  });

  if (existingBranch) {
    throw new AppError("Branch already exists", 409);
  }

  const branch = await prisma.$transaction(async (tx) => {
    const createdBranch = await tx.branch.create({
      data: {
        name: payload.name.trim(),
        address: payload.address.trim(),
        phone: payload.phone?.trim() || null,
        description: payload.description?.trim() || null,
        imageObjectKey: payload.imageObjectKey || null,
      },
    });

    // -------------------------------------------------
    // Create default booking policy for every new branch
    // -------------------------------------------------

    await tx.branchBookingPolicy.create({
      data: {
        branchId: createdBranch.id,

        slotIntervalMinutes: 30,

        minimumBookingNoticeMinutes: 120,

        maximumAdvanceBookingDays: 30,

        cancellationCutoffHours: 12,

        rescheduleCutoffHours: 12,

        reserveExpiryRule: "APPOINTMENT_TIME",

        // Deposit is always available by default
        depositEnabled: true,

        // Default down payment = 10%
        depositPercentage: 10,
      },
    });

    return createdBranch;
  });

  return branch;
};

// =====================================================
// GET ALL BRANCHES
// =====================================================

const getBranches = async (query: Record<string, any>) => {
  const limit = query.limit ? Number(query.limit) : 20;

  const page = query.page ? Number(query.page) : 1;

  const skip = (page - 1) * limit;

  const sortBy = query.sortBy ? query.sortBy : "createdAt";

  const sortOrder = query.sortOrder ? query.sortOrder : "desc";

  const andConditions: Prisma.BranchWhereInput[] = [];

  if (query.status) {
    andConditions.push({
      status: query.status as BranchStatus,
    });
  }

  const branches = await prisma.branch.findMany({
    where: {
      AND: andConditions,
    },

    take: limit,

    skip,

    orderBy: {
      [sortBy]: sortOrder,
    },
  });

  const totalBranchCount = await prisma.branch.count({
    where: {
      AND: andConditions,
    },
  });

  const totalPages =
    totalBranchCount === 0 ? 0 : Math.ceil(totalBranchCount / limit);

  return {
    items: branches,

    pagination: {
      page,

      limit,

      total: totalBranchCount,

      totalPages,

      hasNextPage: page < totalPages,

      hasPreviousPage: page > 1,
    },
  };
};

// =====================================================
// GET SINGLE BRANCH
// =====================================================

const getBranchById = async (branchId: string) => {
  const branch = await prisma.branch.findUnique({
    where: {
      id: branchId,
    },
  });

  if (!branch) {
    throw new AppError("Branch not found", 404);
  }

  return branch;
};

// =====================================================
// UPDATE BRANCH
// =====================================================

const updateBranch = async (
  branchId: string,
  payload: IUpdateBranchPayload,
) => {
  const branch = await prisma.branch.findUnique({
    where: {
      id: branchId,
    },
  });

  if (!branch) {
    throw new AppError("Branch not found", 404);
  }

  if (payload.name) {
    const existingBranch = await prisma.branch.findFirst({
      where: {
        name: {
          equals: payload.name.trim(),
          mode: "insensitive",
        },

        NOT: {
          id: branchId,
        },
      },
    });

    if (existingBranch) {
      throw new AppError("Branch already exists", 409);
    }
  }

  const updatedBranch = await prisma.branch.update({
    where: {
      id: branchId,
    },

    data: {
      name: payload.name?.trim(),

      address: payload.address?.trim(),

      phone: payload.phone?.trim(),

      description: payload.description?.trim(),

      imageObjectKey: payload.imageObjectKey,
    },
  });

  return updatedBranch;
};

// =====================================================
// UPDATE BRANCH STATUS
// =====================================================

const updateBranchStatus = async (
  branchId: string,
  payload: IUpdateBranchStatusPayload,
  userId: string,
) => {
  const branch = await prisma.branch.findUnique({
    where: {
      id: branchId,
    },
  });

  if (!branch) {
    throw new AppError("Branch not found", 404);
  }

  // =====================================================
  // SAME STATUS — NO UPDATE / NO AUDIT
  // =====================================================

  if (branch.status === payload.status) {
    return branch;
  }

  // =====================================================
  // UPDATE + AUDIT
  // =====================================================

  const updatedBranch = await prisma.$transaction(async (tx) => {
    const result = await tx.branch.update({
      where: {
        id: branchId,
      },

      data: {
        status: payload.status,
      },
    });

    await auditLogService.createAuditLog(
      {
        userId,

        action: "BRANCH_STATUS_CHANGED",

        entityType: "BRANCH",

        entityId: branchId,

        metadata: {
          previousStatus: branch.status,
          newStatus: result.status,
        },
      },
      tx,
    );

    return result;
  });

  return updatedBranch;
};

// =====================================================
// GET BUSINESS HOURS
// =====================================================

const getBusinessHours = async (branchId: string) => {
  const branch = await prisma.branch.findUnique({
    where: {
      id: branchId,
    },
  });

  if (!branch) {
    throw new AppError("Branch not found", 404);
  }

  const businessHours = await prisma.branchBusinessHour.findMany({
    where: {
      branchId,
    },

    select: {
      day: true,

      isClosed: true,

      openTime: true,

      closeTime: true,
    },
  });

  return {
    hours: businessHours,
  };
};

// =====================================================
// UPDATE BUSINESS HOURS
// =====================================================

const updateBusinessHours = async (
  branchId: string,
  payload: IUpdateBusinessHoursPayload,
) => {
  const branch = await prisma.branch.findUnique({
    where: {
      id: branchId,
    },
  });

  if (!branch) {
    throw new AppError("Branch not found", 404);
  }

  const days = payload.hours.map((hour) => hour.day);

  const uniqueDays = new Set(days);

  if (uniqueDays.size !== days.length) {
    throw new AppError("Duplicate business hour day is not allowed", 400);
  }

  await prisma.$transaction(
    payload.hours.map((hour) =>
      prisma.branchBusinessHour.upsert({
        where: {
          branchId_day: {
            branchId,

            day: hour.day,
          },
        },

        update: {
          isClosed: hour.isClosed,

          openTime: hour.isClosed ? null : hour.openTime,

          closeTime: hour.isClosed ? null : hour.closeTime,
        },

        create: {
          branchId,

          day: hour.day,

          isClosed: hour.isClosed,

          openTime: hour.isClosed ? null : hour.openTime,

          closeTime: hour.isClosed ? null : hour.closeTime,
        },
      }),
    ),
  );

  const businessHours = await prisma.branchBusinessHour.findMany({
    where: {
      branchId,
    },

    select: {
      day: true,

      isClosed: true,

      openTime: true,

      closeTime: true,
    },
  });

  return {
    branchId,

    hours: businessHours,
  };
};

// =====================================================
// GET BOOKING POLICY
// =====================================================

const getBookingPolicy = async (branchId: string) => {
  const branch = await prisma.branch.findUnique({
    where: {
      id: branchId,
    },
  });

  if (!branch) {
    throw new AppError("Branch not found", 404);
  }

  let bookingPolicy = await prisma.branchBookingPolicy.findUnique({
    where: {
      branchId,
    },
  });

  // ---------------------------------------------------
  // Safety fallback for old branches created before
  // automatic booking-policy creation was introduced
  // ---------------------------------------------------

  if (!bookingPolicy) {
    bookingPolicy = await prisma.branchBookingPolicy.create({
      data: {
        branchId,

        slotIntervalMinutes: 30,

        minimumBookingNoticeMinutes: 120,

        maximumAdvanceBookingDays: 30,

        cancellationCutoffHours: 12,

        rescheduleCutoffHours: 12,

        reserveExpiryRule: "APPOINTMENT_TIME",

        depositEnabled: true,

        depositPercentage: 10,
      },
    });
  }

  return {
    slotIntervalMinutes: bookingPolicy.slotIntervalMinutes,

    minimumBookingNoticeMinutes: bookingPolicy.minimumBookingNoticeMinutes,

    maximumAdvanceBookingDays: bookingPolicy.maximumAdvanceBookingDays,

    cancellationCutoffHours: bookingPolicy.cancellationCutoffHours,

    rescheduleCutoffHours: bookingPolicy.rescheduleCutoffHours,

    reserveExpiryRule: bookingPolicy.reserveExpiryRule,

    // Deposit is always available
    depositEnabled: true,

    depositPercentage:
      bookingPolicy.depositPercentage !== null
        ? Number(bookingPolicy.depositPercentage)
        : 10,
  };
};

// =====================================================
// UPDATE BOOKING POLICY
// =====================================================

const updateBookingPolicy = async (
  branchId: string,
  payload: IUpdateBookingPolicyPayload,
  userId: string,
) => {
  const branch = await prisma.branch.findUnique({
    where: {
      id: branchId,
    },
  });

  if (!branch) {
    throw new AppError("Branch not found", 404);
  }

  // =====================================================
  // 1. GET EXISTING POLICY
  // =====================================================

  const existingPolicy = await prisma.branchBookingPolicy.findUnique({
    where: {
      branchId,
    },
  });

  // =====================================================
  // 2. UPDATE / CREATE + AUDIT
  // =====================================================

  const result = await prisma.$transaction(async (tx) => {
    const updatedPolicy = await tx.branchBookingPolicy.upsert({
      where: {
        branchId,
      },

      update: {
        slotIntervalMinutes: payload.slotIntervalMinutes,

        minimumBookingNoticeMinutes: payload.minimumBookingNoticeMinutes,

        maximumAdvanceBookingDays: payload.maximumAdvanceBookingDays,

        cancellationCutoffHours: payload.cancellationCutoffHours,

        rescheduleCutoffHours: payload.rescheduleCutoffHours,

        reserveExpiryRule: payload.reserveExpiryRule,

        // Deposit is always enabled
        depositEnabled: true,

        // Owner can only change percentage
        depositPercentage: payload.depositPercentage,
      },

      create: {
        branchId,

        slotIntervalMinutes: payload.slotIntervalMinutes,

        minimumBookingNoticeMinutes: payload.minimumBookingNoticeMinutes,

        maximumAdvanceBookingDays: payload.maximumAdvanceBookingDays,

        cancellationCutoffHours: payload.cancellationCutoffHours,

        rescheduleCutoffHours: payload.rescheduleCutoffHours,

        reserveExpiryRule: payload.reserveExpiryRule,

        depositEnabled: true,

        depositPercentage: payload.depositPercentage,
      },
    });

    await auditLogService.createAuditLog(
      {
        userId,

        action: "BOOKING_POLICY_UPDATED",

        entityType: "BRANCH",

        entityId: branchId,

        metadata: {
          previousPolicy: existingPolicy
            ? {
                slotIntervalMinutes: existingPolicy.slotIntervalMinutes,

                minimumBookingNoticeMinutes:
                  existingPolicy.minimumBookingNoticeMinutes,

                maximumAdvanceBookingDays:
                  existingPolicy.maximumAdvanceBookingDays,

                cancellationCutoffHours: existingPolicy.cancellationCutoffHours,

                rescheduleCutoffHours: existingPolicy.rescheduleCutoffHours,

                reserveExpiryRule: existingPolicy.reserveExpiryRule,

                depositEnabled: existingPolicy.depositEnabled,

                depositPercentage: existingPolicy.depositPercentage,
              }
            : null,

          newPolicy: {
            slotIntervalMinutes: updatedPolicy.slotIntervalMinutes,

            minimumBookingNoticeMinutes:
              updatedPolicy.minimumBookingNoticeMinutes,

            maximumAdvanceBookingDays: updatedPolicy.maximumAdvanceBookingDays,

            cancellationCutoffHours: updatedPolicy.cancellationCutoffHours,

            rescheduleCutoffHours: updatedPolicy.rescheduleCutoffHours,

            reserveExpiryRule: updatedPolicy.reserveExpiryRule,

            depositEnabled: updatedPolicy.depositEnabled,

            depositPercentage: updatedPolicy.depositPercentage,
          },
        },
      },

      tx,
    );

    return updatedPolicy;
  });

  return {
    branchId: result.branchId,
  };
};

const searchBranchCustomers = async (
  branchId: string,
  userId: string,
  role: Role,
  query: ICustomerOperationalSearchQuery,
): Promise<ICustomerOperationalSearchResponse> => {
  // =====================================================
  // 1. CHECK BRANCH
  // =====================================================

  const branch = await prisma.branch.findUnique({
    where: {
      id: branchId,
    },

    select: {
      id: true,
    },
  });

  if (!branch) {
    throw new AppError("BRANCH_NOT_FOUND", 404);
  }

  // =====================================================
  // 2. ROLE CHECK
  // =====================================================

  if (role !== Role.BRAND_OWNER && role !== Role.BRANCH_MANAGER) {
    throw new AppError("FORBIDDEN", 403);
  }

  // =====================================================
  // 3. BRANCH MANAGER SCOPE
  // =====================================================

  if (role === Role.BRANCH_MANAGER) {
    const managerBranch = await prisma.branchManagerBranch.findUnique({
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

    if (!managerBranch) {
      throw new AppError("FORBIDDEN_BRANCH_SCOPE", 403);
    }
  }

  // =====================================================
  // 4. SEARCH TERM
  // =====================================================

  const q = query.q.trim();

  // =====================================================
  // 5. SEARCH BRANCH-RELEVANT CUSTOMERS
  // =====================================================

  const customers = await prisma.user.findMany({
    where: {
      role: Role.CUSTOMER,

      status: UserStatus.ACTIVE,

      // Customer must have appointment history
      // in this exact branch.
      appointments: {
        some: {
          branchId,
        },
      },

      OR: [
        {
          name: {
            contains: q,
            mode: "insensitive",
          },
        },

        {
          phone: {
            contains: q,
          },
        },

        {
          email: {
            contains: q,
            mode: "insensitive",
          },
        },
      ],
    },

    take: 20,

    orderBy: {
      name: "asc",
    },

    select: {
      id: true,
      name: true,
      phone: true,
    },
  });

  // =====================================================
  // 6. RESPONSE
  // =====================================================

  return {
    items: customers.map((customer) => ({
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
    })),
  };
};

export const branchService = {
  createBranch,

  getBranches,

  getBranchById,

  updateBranch,

  updateBranchStatus,

  getBusinessHours,

  updateBusinessHours,

  getBookingPolicy,

  updateBookingPolicy,
  searchBranchCustomers,
};
