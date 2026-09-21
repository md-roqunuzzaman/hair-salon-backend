import { BranchStatus, Prisma } from "../../../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../utils/app-error.js";

import {
  ICreateBranchPayload,
  IUpdateBookingPolicyPayload,
  IUpdateBranchPayload,
  IUpdateBranchStatusPayload,
  IUpdateBusinessHoursPayload,
} from "./branch.interface.js";

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

  const branch = await prisma.branch.create({
    data: {
      name: payload.name.trim(),
      address: payload.address.trim(),
      phone: payload.phone?.trim() || null,
      description: payload.description?.trim() || null,
      imageObjectKey: payload.imageObjectKey || null,
    },
  });

  return branch;
};

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

  return {
    items: branches,
    pagination: {
      page,
      limit,
      total: totalBranchCount,
      totalPages: Math.ceil(totalBranchCount / limit),
      hasNextPage: page < Math.ceil(totalBranchCount / limit),
      hasPreviousPage: page > 1,
    },
  };
};
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

const updateBranchStatus = async (
  branchId: string,
  payload: IUpdateBranchStatusPayload,
) => {
  const branch = await prisma.branch.findUnique({
    where: {
      id: branchId,
    },
  });

  if (!branch) {
    throw new AppError("Branch not found", 404);
  }

  const updatedBranch = await prisma.branch.update({
    where: {
      id: branchId,
    },
    data: {
      status: payload.status,
    },
  });

  return updatedBranch;
};

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
  };
};

const updateBookingPolicy = async (
  branchId: string,
  payload: IUpdateBookingPolicyPayload,
) => {
  const branch = await prisma.branch.findUnique({
    where: {
      id: branchId,
    },
  });

  if (!branch) {
    throw new AppError("Branch not found", 404);
  }

  await prisma.branchBookingPolicy.upsert({
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
    },

    create: {
      branchId,

      slotIntervalMinutes: payload.slotIntervalMinutes,

      minimumBookingNoticeMinutes: payload.minimumBookingNoticeMinutes,

      maximumAdvanceBookingDays: payload.maximumAdvanceBookingDays,

      cancellationCutoffHours: payload.cancellationCutoffHours,

      rescheduleCutoffHours: payload.rescheduleCutoffHours,

      reserveExpiryRule: payload.reserveExpiryRule,
    },
  });

  return {
    branchId,
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
};
