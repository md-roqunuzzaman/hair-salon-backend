import bcrypt from "bcrypt";
import crypto from "node:crypto";

import { Role, UserStatus } from "../../../../generated/prisma/client.js";

import config from "../../config/index.js";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../utils/app-error.js";

import {
  ICreateBranchManagerPayload,
  IUpdateBranchManagerBranchesPayload,
  IUpdateBranchManagerStatusPayload,
} from "./branch-manager.interface.js";

const createBranchManager = async (payload: ICreateBranchManagerPayload) => {
  const name = payload.name.trim();

  const email = payload.email.trim().toLowerCase();

  const phone = payload.phone?.trim() || null;

  // =====================================================
  // 1. CHECK EMAIL
  // =====================================================

  const existingEmail = await prisma.user.findUnique({
    where: {
      email,
    },

    select: {
      id: true,
    },
  });

  if (existingEmail) {
    throw new AppError("User with this email already exists", 409);
  }

  // =====================================================
  // 2. CHECK PHONE
  // =====================================================

  if (phone) {
    const existingPhone = await prisma.user.findUnique({
      where: {
        phone,
      },

      select: {
        id: true,
      },
    });

    if (existingPhone) {
      throw new AppError("User with this phone number already exists", 409);
    }
  }

  // =====================================================
  // 3. VALIDATE BRANCHES
  // =====================================================

  const branches = await prisma.branch.findMany({
    where: {
      id: {
        in: payload.branchIds,
      },
    },

    select: {
      id: true,
    },
  });

  if (branches.length !== payload.branchIds.length) {
    throw new AppError("One or more branches were not found", 404);
  }

  // =====================================================
  // 4. GENERATE TEMPORARY PASSWORD
  // =====================================================

  const temporaryPassword = crypto.randomBytes(12).toString("base64url");

  const passwordHash = await bcrypt.hash(
    temporaryPassword,
    Number(config.bcrypt_salt_rounds),
  );

  // =====================================================
  // 5. CREATE USER + BRANCH ASSIGNMENTS
  // =====================================================

  const manager = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        name,
        email,
        phone,

        passwordHash,

        role: Role.BRANCH_MANAGER,

        status: UserStatus.ACTIVE,

        mustChangePassword: true,
      },

      select: {
        id: true,
        name: true,
        status: true,
      },
    });

    await tx.branchManagerBranch.createMany({
      data: payload.branchIds.map((branchId) => ({
        userId: user.id,
        branchId,
      })),
    });

    return user;
  });

  return {
    id: manager.id,
    name: manager.name,
    branchIds: payload.branchIds,
    status: manager.status,
    temporaryPassword,
  };
};

const getBranchManagers = async () => {
  const managers = await prisma.user.findMany({
    where: {
      role: Role.BRANCH_MANAGER,
    },

    orderBy: {
      createdAt: "desc",
    },

    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      status: true,

      managedBranches: {
        select: {
          branchId: true,
        },
      },
    },
  });

  return {
    items: managers.map((manager) => ({
      id: manager.id,
      name: manager.name,
      email: manager.email,
      phone: manager.phone,

      branchIds: manager.managedBranches.map((branch) => branch.branchId),

      status: manager.status,
    })),
  };
};

const getBranchManagerById = async (managerId: string) => {
  const manager = await prisma.user.findFirst({
    where: {
      id: managerId,
      role: Role.BRANCH_MANAGER,
    },

    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      status: true,

      managedBranches: {
        select: {
          branchId: true,

          branch: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
    },
  });

  if (!manager) {
    throw new AppError("Branch manager not found", 404);
  }

  return {
    id: manager.id,
    name: manager.name,
    email: manager.email,
    phone: manager.phone,

    branchIds: manager.managedBranches.map((item) => item.branchId),

    branches: manager.managedBranches.map((item) => ({
      id: item.branch.id,
      name: item.branch.name,
    })),

    status: manager.status,
  };
};

const updateBranchManagerBranches = async (
  managerId: string,
  payload: IUpdateBranchManagerBranchesPayload,
) => {
  // =====================================================
  // 1. MANAGER EXISTS + CORRECT ROLE
  // =====================================================

  const manager = await prisma.user.findFirst({
    where: {
      id: managerId,
      role: Role.BRANCH_MANAGER,
    },

    select: {
      id: true,
    },
  });

  if (!manager) {
    throw new AppError("Branch manager not found", 404);
  }

  // =====================================================
  // 2. VALIDATE ALL BRANCH IDS
  // =====================================================

  const branches = await prisma.branch.findMany({
    where: {
      id: {
        in: payload.branchIds,
      },
    },

    select: {
      id: true,
    },
  });

  if (branches.length !== payload.branchIds.length) {
    throw new AppError("One or more branches were not found", 404);
  }

  // =====================================================
  // 3. REPLACE BRANCH ASSIGNMENTS
  // =====================================================

  await prisma.$transaction(async (tx) => {
    await tx.branchManagerBranch.deleteMany({
      where: {
        userId: managerId,
      },
    });

    await tx.branchManagerBranch.createMany({
      data: payload.branchIds.map((branchId) => ({
        userId: managerId,
        branchId,
      })),
    });
  });

  return {
    managerId,
    branchIds: payload.branchIds,
  };
};

const updateBranchManagerStatus = async (
  managerId: string,
  payload: IUpdateBranchManagerStatusPayload,
) => {
  // =====================================================
  // 1. VERIFY USER IS A BRANCH MANAGER
  // =====================================================

  const manager = await prisma.user.findFirst({
    where: {
      id: managerId,
      role: Role.BRANCH_MANAGER,
    },

    select: {
      id: true,
      status: true,
    },
  });

  if (!manager) {
    throw new AppError("Branch manager not found", 404);
  }

  // =====================================================
  // 2. UPDATE STATUS
  // =====================================================

  const updatedManager = await prisma.user.update({
    where: {
      id: managerId,
    },

    data: {
      status: payload.status,
    },

    select: {
      id: true,
      status: true,
    },
  });

  return {
    managerId: updatedManager.id,
    status: updatedManager.status,
  };
};
export const branchManagerService = {
  createBranchManager,
  getBranchManagers,
  getBranchManagerById,
  updateBranchManagerBranches,
  updateBranchManagerStatus,
};
