import {
  AppointmentStatus,
  Prisma,
  Role,
} from "../../../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../utils/app-error.js";
import {
  IAdminUserQuery,
  IUpdateAdminUserStatusPayload,
} from "./admin.interface.js";

const getAdminUsers = async (query: IAdminUserQuery) => {
  const page = query.page ?? 1;
  const limit = query.limit ?? 20;

  const skip = (page - 1) * limit;

  const where: Prisma.UserWhereInput = {};

  if (query.role) {
    where.role = query.role;
  }

  if (query.status) {
    where.status = query.status;
  }

  if (query.q) {
    where.OR = [
      {
        name: {
          contains: query.q,
          mode: "insensitive",
        },
      },
      {
        email: {
          contains: query.q,
          mode: "insensitive",
        },
      },
      {
        phone: {
          contains: query.q,
          mode: "insensitive",
        },
      },
    ];
  }

  const [users, total] = await prisma.$transaction([
    prisma.user.findMany({
      where,

      skip,
      take: limit,

      orderBy: {
        createdAt: "desc",
      },

      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        status: true,
      },
    }),

    prisma.user.count({
      where,
    }),
  ]);

  return {
    items: users,

    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

const getAdminUserById = async (userId: string) => {
  const user = await prisma.user.findUnique({
    where: {
      id: userId,
    },

    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      avatarObjectKey: true,
      role: true,
      status: true,
      createdAt: true,
      updatedAt: true,

      wallet: {
        select: {
          paidBalance: true,
          bonusBalance: true,
          currency: true,
        },
      },

      staffProfile: {
        select: {
          id: true,
          roleTitle: true,
          specialization: true,
          status: true,

          branches: {
            select: {
              branch: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
        },
      },

      managedBranches: {
        select: {
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

  if (!user) {
    throw new AppError("User not found", 404);
  }

  const [
    totalAppointments,
    completedAppointments,
    cancelledAppointments,
    noShowAppointments,
    totalReviews,
    totalGroupPurchases,
  ] = await prisma.$transaction([
    prisma.appointment.count({
      where: {
        customerId: user.id,
      },
    }),

    prisma.appointment.count({
      where: {
        customerId: user.id,
        appointmentStatus: AppointmentStatus.COMPLETED,
      },
    }),

    prisma.appointment.count({
      where: {
        customerId: user.id,
        appointmentStatus: AppointmentStatus.CANCELLED,
      },
    }),

    prisma.appointment.count({
      where: {
        customerId: user.id,
        appointmentStatus: AppointmentStatus.NO_SHOW,
      },
    }),

    prisma.review.count({
      where: {
        customerId: user.id,
      },
    }),

    prisma.groupPurchase.count({
      where: {
        customerId: user.id,
      },
    }),
  ]);

  let roleDetails: unknown = null;

  if (user.role === Role.STAFF && user.staffProfile) {
    roleDetails = {
      staffId: user.staffProfile.id,

      roleTitle: user.staffProfile.roleTitle,

      specialization: user.staffProfile.specialization,

      status: user.staffProfile.status,

      branches: user.staffProfile.branches.map((item) => ({
        id: item.branch.id,
        name: item.branch.name,
      })),
    };
  }

  if (user.role === Role.BRANCH_MANAGER) {
    roleDetails = {
      managedBranches: user.managedBranches.map((item) => ({
        id: item.branch.id,
        name: item.branch.name,
      })),
    };
  }

  const paidBalance = user.wallet ? Number(user.wallet.paidBalance) : 0;

  const bonusBalance = user.wallet ? Number(user.wallet.bonusBalance) : 0;

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    status: user.status,

    // R2 is not implemented yet.
    // Later convert avatarObjectKey -> usable URL.
    avatarUrl: null,

    createdAt: user.createdAt,
    updatedAt: user.updatedAt,

    stats: {
      totalAppointments,
      completedAppointments,
      cancelledAppointments,
      noShowAppointments,
      totalReviews,
      totalGroupPurchases,
    },

    wallet:
      user.role === Role.CUSTOMER
        ? {
            paidBalance,
            bonusBalance,
            totalBalance: paidBalance + bonusBalance,
            currency: user.wallet?.currency ?? "HKD",
          }
        : null,

    roleDetails,
  };
};

const updateAdminUserStatus = async (
  userId: string,
  payload: IUpdateAdminUserStatusPayload,
) => {
  const user = await prisma.user.findUnique({
    where: {
      id: userId,
    },

    select: {
      id: true,
      role: true,
      status: true,
    },
  });

  if (!user) {
    throw new AppError("User not found", 404);
  }

  const updatedUser = await prisma.user.update({
    where: {
      id: userId,
    },

    data: {
      status: payload.status,
    },

    select: {
      id: true,
      status: true,
    },
  });

  return updatedUser;
};

export const adminUserService = {
  getAdminUsers,
  getAdminUserById,
  updateAdminUserStatus,
};
