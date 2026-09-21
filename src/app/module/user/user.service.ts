import config from "../../config/index.js";
import { prisma } from "../../lib/prisma.js";

import bcrypt from "bcrypt";
import {
  IChangePasswordPayload,
  IUpdateProfilePayload,
} from "./user.interface.js";
import { invalidateUserRefreshSessions } from "../auth/auth.service.js";
import { AppError } from "../../utils/app-error.js";

const getMe = async (userId: string) => {
  const user = await prisma.user.findUnique({
    where: {
      id: userId,
    },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!user) {
    throw new AppError("User not found", 404);
  }

  return user;
};

const updateMe = async (userId: string, payload: IUpdateProfilePayload) => {
  const phone = payload.phone?.trim();

  if (phone) {
    const existingPhone = await prisma.user.findUnique({
      where: {
        phone,
      },
    });

    if (existingPhone && existingPhone.id !== userId) {
      throw new AppError("User with this phone number already exists", 409);
    }
  }

  const updatedUser = await prisma.user.update({
    where: {
      id: userId,
    },
    data: {
      ...(payload.name && {
        name: payload.name.trim(),
      }),

      ...(phone !== undefined && {
        phone,
      }),
    },

    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return updatedUser;
};

const changePassword = async (
  userId: string,
  payload: IChangePasswordPayload,
) => {
  const user = await prisma.user.findUnique({
    where: {
      id: userId,
    },
  });

  if (!user) {
    throw new AppError("User not found", 404);
  }

  const isPasswordMatched = await bcrypt.compare(
    payload.currentPassword,
    user.passwordHash,
  );

  if (!isPasswordMatched) {
    throw new AppError("Current password is incorrect", 401);
  }

  const isSamePassword = await bcrypt.compare(
    payload.newPassword,
    user.passwordHash,
  );

  if (isSamePassword) {
    throw new AppError(
      "New password must be different from current password",
      400,
    );
  }

  const hashedPassword = await bcrypt.hash(
    payload.newPassword,
    Number(config.bcrypt_salt_rounds),
  );

  await prisma.user.update({
    where: {
      id: userId,
    },
    data: {
      passwordHash: hashedPassword,
      mustChangePassword: false,
    },
  });

  await invalidateUserRefreshSessions(user.id);

  return null;
};
export const userService = {
  getMe,
  updateMe,
  changePassword,
};
