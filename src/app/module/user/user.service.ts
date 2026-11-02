import config from "../../config/index.js";
import { prisma } from "../../lib/prisma.js";

import bcrypt from "bcrypt";
import {
  IChangePasswordPayload,
  IUpdateProfilePayload,
} from "./user.interface.js";
import { invalidateUserRefreshSessions } from "../auth/auth.service.js";
import { AppError } from "../../utils/app-error.js";
import { uploadService } from "../upload/upload.service.js";
import { logUnexpectedError } from "../../utils/normalize-error.js";
import { UserStatus } from "../../../../generated/prisma/enums.js";
import { assertBcryptPasswordLength } from "../../utils/password-security.js";

const getMe = async (userId: string) => {
  // =====================================================
  // 1. FETCH USER WITH STAFF RELATION
  // =====================================================

  const user = await prisma.user.findUnique({
    where: {
      id: userId,
    },

    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      mustChangePassword: true,

      avatarObjectKey: true,

      role: true,
      status: true,

      staffProfile: {
        select: {
          id: true,
        },
      },

      createdAt: true,
      updatedAt: true,
    },
  });

  if (!user) {
    throw new AppError("User not found", 404);
  }

  // =====================================================
  // 2. GENERATE SIGNED AVATAR URL
  // =====================================================

  const avatarUrl = user.avatarObjectKey
    ? await uploadService.getImageUrl(user.avatarObjectKey)
    : null;

  // =====================================================
  // 3. RESPONSE
  // =====================================================

  return {
    id: user.id,

    // Only STAFF receives staffId.
    ...(user.role === "STAFF" && {
      staffId: user.staffProfile?.id ?? null,
    }),

    name: user.name,

    email: user.email,

    phone: user.phone,
    mustChangePassword: user.mustChangePassword,

    avatarObjectKey: user.avatarObjectKey,

    avatarUrl,

    role: user.role,

    status: user.status,

    createdAt: user.createdAt,

    updatedAt: user.updatedAt,
  };
};
const updateMe = async (userId: string, payload: IUpdateProfilePayload) => {
  // =====================================================
  // 1. CHECK USER
  // =====================================================

  const user = await prisma.user.findUnique({
    where: {
      id: userId,
    },

    select: {
      id: true,
      avatarObjectKey: true,
    },
  });

  if (!user) {
    throw new AppError("User not found", 404);
  }

  // =====================================================
  // 2. PHONE VALIDATION
  // =====================================================

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

  // =====================================================
  // 3. AVATAR R2 VALIDATION
  // =====================================================

  if (payload.avatarObjectKey !== undefined) {
    const expectedPrefix = `users/${userId}/`;

    if (!payload.avatarObjectKey.startsWith(expectedPrefix)) {
      throw new AppError("Invalid user avatar object key", 400);
    }

    await uploadService.verifyImageExists(payload.avatarObjectKey);
  }

  // =====================================================
  // 4. UPDATE USER
  // =====================================================

  const updatedUser = await prisma.user.update({
    where: {
      id: userId,
    },

    data: {
      ...(payload.name !== undefined && {
        name: payload.name.trim(),
      }),

      ...(phone !== undefined && {
        phone,
      }),

      ...(payload.avatarObjectKey !== undefined && {
        avatarObjectKey: payload.avatarObjectKey,
      }),
    },

    select: {
      id: true,
      name: true,
      email: true,
      phone: true,

      avatarObjectKey: true,

      role: true,
      status: true,

      // =================================================
      // STAFF PROFILE RELATION
      // =================================================

      staffProfile: {
        select: {
          id: true,
        },
      },

      createdAt: true,
      updatedAt: true,
    },
  });

  // =====================================================
  // 5. GENERATE SIGNED AVATAR URL
  // =====================================================

  const avatarUrl = updatedUser.avatarObjectKey
    ? await uploadService.getImageUrl(updatedUser.avatarObjectKey)
    : null;

  // =====================================================
  // 6. RESPONSE
  // =====================================================

  return {
    id: updatedUser.id,

    // Only STAFF receives staffId
    ...(updatedUser.role === "STAFF" && {
      staffId: updatedUser.staffProfile?.id ?? null,
    }),

    name: updatedUser.name,

    email: updatedUser.email,

    phone: updatedUser.phone,

    avatarObjectKey: updatedUser.avatarObjectKey,

    avatarUrl,

    role: updatedUser.role,

    status: updatedUser.status,

    createdAt: updatedUser.createdAt,

    updatedAt: updatedUser.updatedAt,
  };
};
const changePassword = async (
  userId: string,
  payload: IChangePasswordPayload,
) => {
  // =====================================================
  // S5 SECURITY: ENFORCE BCRYPT 72-BYTE PASSWORD LIMIT
  // =====================================================

  assertBcryptPasswordLength(payload.newPassword);

  // =====================================================
  // 1. FIND ACTIVE USER
  // =====================================================

  const user = await prisma.user.findUnique({
    where: {
      id: userId,
    },
    select: {
      id: true,
      status: true,
      passwordHash: true,
    },
  });

  if (!user) {
    throw new AppError("User not found", 404);
  }

  if (user.status !== UserStatus.ACTIVE) {
    throw new AppError("User account is inactive", 403);
  }

  // =====================================================
  // 2. VERIFY CURRENT PASSWORD
  // =====================================================

  const isPasswordMatched = await bcrypt.compare(
    payload.currentPassword,
    user.passwordHash,
  );

  if (!isPasswordMatched) {
    throw new AppError("Current password is incorrect", 401);
  }

  // =====================================================
  // 3. PREVENT PASSWORD REUSE
  // =====================================================

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

  // =====================================================
  // 4. HASH NEW PASSWORD
  // =====================================================

  const hashedPassword = await bcrypt.hash(
    payload.newPassword,
    Number(config.bcrypt_salt_rounds),
  );

  // =====================================================
  // 5. UPDATE PASSWORD + CLEAR REQUIRED FLAG
  // =====================================================

  const updated = await prisma.user.updateMany({
    where: {
      id: user.id,
      status: UserStatus.ACTIVE,
      passwordHash: user.passwordHash,
    },
    data: {
      passwordHash: hashedPassword,
      mustChangePassword: false,
    },
  });

  if (updated.count !== 1) {
    throw new AppError(
      "Password was changed by another request. Please try again.",
      409,
    );
  }

  // =====================================================
  // 6. INVALIDATE REFRESH SESSIONS
  // =====================================================

  try {
    await invalidateUserRefreshSessions(user.id);
  } catch (error) {
    logUnexpectedError(error, {
      source: "users.changePassword.invalidateSessions",
    });

    throw new AppError(
      "Password updated, but existing sessions could not be revoked. Please contact support.",
      503,
    );
  }

  // =====================================================
  // 7. RETURN
  // =====================================================

  // Existing controller response contract remains unchanged.
  // Frontend should clear tokens/cookies and require login again.

  return null;
};
export const userService = {
  getMe,
  updateMe,
  changePassword,
};
