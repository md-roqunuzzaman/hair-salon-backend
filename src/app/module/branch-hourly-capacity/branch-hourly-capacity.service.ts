import { Role } from "../../../../generated/prisma/client.js";

import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../utils/app-error.js";

import {
  IGetBranchHourlyCapacityResponse,
  IUpdateBranchHourlyCapacityPayload,
} from "./branch-hourly-capacity.interface.js";

const getBranchHourlyCapacity = async (
  branchId: string,
  requester: {
    userId: string;
    role: Role;
  },
): Promise<IGetBranchHourlyCapacityResponse> => {
  const branch = await prisma.branch.findUnique({
    where: {
      id: branchId,
    },

    select: {
      id: true,
    },
  });

  if (!branch) {
    throw new AppError("Branch not found", 404);
  }

  if (requester.role === Role.BRANCH_MANAGER) {
    const managerBranch = await prisma.branchManagerBranch.findFirst({
      where: {
        userId: requester.userId,
        branchId,
      },

      select: {
        branchId: true,
      },
    });

    if (!managerBranch) {
      throw new AppError("You are not allowed to access this branch", 403);
    }
  }

  const capacities = await prisma.branchHourlyCapacity.findMany({
    where: {
      branchId,
    },

    orderBy: {
      day: "asc",
    },
  });

  return {
    branchId,

    capacities: capacities.map((item) => ({
      id: item.id,
      day: item.day,
      maxBookingsPerHour: item.maxBookingsPerHour,
    })),
  };
};

const updateBranchHourlyCapacity = async (
  branchId: string,
  payload: IUpdateBranchHourlyCapacityPayload,
  requester: {
    userId: string;
    role: Role;
  },
) => {
  const branch = await prisma.branch.findUnique({
    where: {
      id: branchId,
    },

    select: {
      id: true,
    },
  });

  if (!branch) {
    throw new AppError("Branch not found", 404);
  }

  if (requester.role === Role.BRANCH_MANAGER) {
    const managerBranch = await prisma.branchManagerBranch.findFirst({
      where: {
        userId: requester.userId,
        branchId,
      },

      select: {
        branchId: true,
      },
    });

    if (!managerBranch) {
      throw new AppError("You are not allowed to update this branch", 403);
    }
  }

  const days = payload.capacities.map((item) => item.day);

  const uniqueDays = new Set(days);

  if (uniqueDays.size !== days.length) {
    throw new AppError("Duplicate capacity days are not allowed", 400);
  }

  const capacities = await prisma.$transaction(async (tx) => {
    await tx.branchHourlyCapacity.deleteMany({
      where: {
        branchId,
      },
    });

    await tx.branchHourlyCapacity.createMany({
      data: payload.capacities.map((item) => ({
        branchId,
        day: item.day,
        maxBookingsPerHour: item.maxBookingsPerHour,
      })),
    });

    return await tx.branchHourlyCapacity.findMany({
      where: {
        branchId,
      },

      orderBy: {
        day: "asc",
      },
    });
  });

  return {
    branchId,

    capacities: capacities.map((item) => ({
      id: item.id,
      day: item.day,
      maxBookingsPerHour: item.maxBookingsPerHour,
    })),
  };
};

export const branchHourlyCapacityService = {
  getBranchHourlyCapacity,
  updateBranchHourlyCapacity,
};
