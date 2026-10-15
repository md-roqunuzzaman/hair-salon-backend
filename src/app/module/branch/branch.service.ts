import {
  AppointmentStatus,
  BranchStatus,
  Prisma,
  ReviewModerationStatus,
  Role,
  StaffStatus,
  UserStatus,
} from "../../../../generated/prisma/client.js";

import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../utils/app-error.js";
import { DEFAULT_LANGUAGE, Language } from "../../utils/language.js";
import { getLocalizedContent } from "../../utils/localization.js";
import { auditLogService } from "../auditLog/auditLog.service.js";
import { notificationService } from "../notification/notification.service.js";
import { notificationTemplates } from "../notification/notification.templates.js";
import { uploadService } from "../upload/upload.service.js";

import {
  IBranchDailySeriesQuery,
  IBranchDailySeriesResult,
  IBranchDailySummaryResult,
  IBranchStaffOutputQuery,
  IBranchStaffOutputResult,
  IBranchTranslations,
  ICreateBranchPayload,
  ICustomerOperationalSearchQuery,
  ICustomerOperationalSearchResponse,
  IUpdateBookingPolicyPayload,
  IUpdateBranchPayload,
  IUpdateBranchStatusPayload,
  IUpdateBusinessHoursPayload,
} from "./branch.interface.js";

// =====================================================
// BRANCH LOCALIZATION HELPERS
// =====================================================

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readBranchTranslations = (value: unknown): IBranchTranslations => {
  if (!isRecord(value)) return {};

  const result: IBranchTranslations = {};

  for (const language of ["en", "zh-CN", "zh-HK"] as const) {
    const locale = value[language];

    if (!isRecord(locale)) continue;

    result[language] = {
      ...(typeof locale.name === "string" && {
        name: locale.name,
      }),
      ...(typeof locale.address === "string" && {
        address: locale.address,
      }),
      ...(typeof locale.description === "string" && {
        description: locale.description,
      }),
    };
  }

  return result;
};

const buildBranchTranslations = (
  existing: unknown,
  incoming: IBranchTranslations | undefined,
  base: {
    name: string;
    address: string;
    description: string | null;
  },
): Prisma.InputJsonObject => {
  const previous = readBranchTranslations(existing);

  const mergeLocale = (language: "zh-CN" | "zh-HK") => ({
    ...(previous[language] ?? {}),
    ...(incoming?.[language] ?? {}),
  });

  return {
    en: {
      name: base.name,
      address: base.address,
      ...(base.description !== null && {
        description: base.description,
      }),
    },

    "zh-CN": mergeLocale("zh-CN"),
    "zh-HK": mergeLocale("zh-HK"),
  };
};

const localizeBranch = (
  branch: {
    name: string;
    address: string;
    description: string | null;
    translations: unknown;
  },
  language: Language,
) => {
  return getLocalizedContent(branch.translations, language, {
    name: branch.name,
    address: branch.address,
    description: branch.description,
  });
};
// =====================================================
// CREATE BRANCH
// =====================================================

const createBranch = async (payload: ICreateBranchPayload) => {
  // =====================================================
  // 1. PREPARE ENGLISH BASE DATA
  // =====================================================

  const name = payload.name.trim();
  const address = payload.address.trim();
  const description = payload.description?.trim() || null;

  // =====================================================
  // 2. DUPLICATE BRANCH CHECK
  // =====================================================

  const existingBranch = await prisma.branch.findFirst({
    where: {
      name: {
        equals: name,
        mode: "insensitive",
      },
    },
  });

  if (existingBranch) {
    throw new AppError("Branch already exists", 409);
  }

  // =====================================================
  // 3. BUILD TRANSLATIONS
  // =====================================================

  const translations = buildBranchTranslations(null, payload.translations, {
    name,
    address,
    description,
  });

  // =====================================================
  // 4. CREATE BRANCH + DEFAULT BOOKING POLICY
  // =====================================================

  const branch = await prisma.$transaction(async (tx) => {
    const createdBranch = await tx.branch.create({
      data: {
        name,
        address,

        phone: payload.phone?.trim() || null,

        description,

        imageObjectKey: payload.imageObjectKey || null,

        translations,
      },
    });

    // -------------------------------------------------
    // CREATE DEFAULT BOOKING POLICY
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

        // Deposit is always enabled
        depositEnabled: true,

        // Default deposit = 10%
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

const getBranches = async (
  query: Record<string, any>,
  language: Language = DEFAULT_LANGUAGE,
) => {
  // =====================================================
  // 1. PAGINATION
  // =====================================================

  const limit = query.limit ? Number(query.limit) : 20;

  const page = query.page ? Number(query.page) : 1;

  const skip = (page - 1) * limit;

  const sortBy = query.sortBy ? query.sortBy : "createdAt";

  const sortOrder = query.sortOrder ? query.sortOrder : "desc";

  // =====================================================
  // 2. FILTERS
  // =====================================================

  const andConditions: Prisma.BranchWhereInput[] = [];

  if (query.status) {
    andConditions.push({
      status: query.status as BranchStatus,
    });
  }

  // =====================================================
  // 3. FETCH BRANCHES + COUNT
  // =====================================================

  const [branches, totalBranchCount] = await Promise.all([
    prisma.branch.findMany({
      where: {
        AND: andConditions,
      },

      take: limit,

      skip,

      orderBy: {
        [sortBy]: sortOrder,
      },

      select: {
        id: true,

        name: true,

        address: true,

        phone: true,

        description: true,

        translations: true,

        imageObjectKey: true,

        status: true,

        createdAt: true,

        updatedAt: true,
      },
    }),

    prisma.branch.count({
      where: {
        AND: andConditions,
      },
    }),
  ]);

  // =====================================================
  // 4. LOCALIZE BRANCHES + GENERATE SIGNED IMAGE URLS
  // =====================================================

  const items = await Promise.all(
    branches.map(async (branch) => {
      const localized = localizeBranch(branch, language);

      const imageUrl = branch.imageObjectKey
        ? await uploadService.getImageUrl(branch.imageObjectKey)
        : null;

      return {
        id: branch.id,

        name: localized.name,

        address: localized.address,

        phone: branch.phone,

        description: localized.description,

        imageObjectKey: branch.imageObjectKey,

        imageUrl,

        status: branch.status,

        createdAt: branch.createdAt,

        updatedAt: branch.updatedAt,
      };
    }),
  );

  // =====================================================
  // 5. PAGINATION
  // =====================================================

  const totalPages =
    totalBranchCount === 0 ? 0 : Math.ceil(totalBranchCount / limit);

  // =====================================================
  // 6. RESPONSE
  // =====================================================

  return {
    items,

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

const getBranchById = async (
  branchId: string,
  language: Language = DEFAULT_LANGUAGE,
) => {
  // =====================================================
  // 1. FIND BRANCH
  // =====================================================

  const branch = await prisma.branch.findUnique({
    where: {
      id: branchId,
    },

    select: {
      id: true,

      name: true,

      address: true,

      phone: true,

      description: true,

      translations: true,

      imageObjectKey: true,

      status: true,

      createdAt: true,

      updatedAt: true,
    },
  });

  if (!branch) {
    throw new AppError("Branch not found", 404);
  }

  // =====================================================
  // 2. LOCALIZE BRANCH CONTENT
  // =====================================================

  const localized = localizeBranch(branch, language);

  // =====================================================
  // 3. GENERATE SIGNED IMAGE URL
  // =====================================================

  const imageUrl = branch.imageObjectKey
    ? await uploadService.getImageUrl(branch.imageObjectKey)
    : null;

  // =====================================================
  // 4. RESPONSE
  // =====================================================

  return {
    id: branch.id,

    name: localized.name,

    address: localized.address,

    phone: branch.phone,

    description: localized.description,

    imageObjectKey: branch.imageObjectKey,

    imageUrl,

    status: branch.status,

    createdAt: branch.createdAt,

    updatedAt: branch.updatedAt,
  };
};
// =====================================================
// UPDATE BRANCH
// =====================================================

const updateBranch = async (
  branchId: string,
  payload: IUpdateBranchPayload,
  language: Language = DEFAULT_LANGUAGE,
) => {
  // =====================================================
  // 1. FIND BRANCH
  // =====================================================

  const branch = await prisma.branch.findUnique({
    where: {
      id: branchId,
    },
  });

  if (!branch) {
    throw new AppError("Branch not found", 404);
  }

  // =====================================================
  // 2. RESOLVE ENGLISH BASE DATA
  // =====================================================

  const nextName =
    payload.name !== undefined
      ? payload.name.trim()
      : payload.translations?.en?.name !== undefined
        ? payload.translations.en.name.trim()
        : branch.name;

  const nextAddress =
    payload.address !== undefined
      ? payload.address.trim()
      : payload.translations?.en?.address !== undefined
        ? payload.translations.en.address.trim()
        : branch.address;

  const nextDescription =
    payload.description !== undefined
      ? payload.description.trim()
      : payload.translations?.en?.description !== undefined
        ? payload.translations.en.description.trim()
        : branch.description;

  // =====================================================
  // 3. DUPLICATE BRANCH NAME CHECK
  // =====================================================

  if (nextName !== branch.name) {
    const existingBranch = await prisma.branch.findFirst({
      where: {
        name: {
          equals: nextName,
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

  // =====================================================
  // 4. IMAGE R2 VALIDATION
  // =====================================================

  if (payload.imageObjectKey !== undefined) {
    const expectedPrefix = `branches/${branchId}/`;

    if (!payload.imageObjectKey.startsWith(expectedPrefix)) {
      throw new AppError("Invalid branch image object key", 400);
    }

    await uploadService.verifyImageExists(payload.imageObjectKey);
  }

  // =====================================================
  // 5. MERGE MULTILINGUAL TRANSLATIONS
  // =====================================================

  const translations = buildBranchTranslations(
    branch.translations,
    payload.translations,
    {
      name: nextName,

      address: nextAddress,

      description: nextDescription,
    },
  );

  // =====================================================
  // 6. UPDATE BRANCH
  // =====================================================

  const updatedBranch = await prisma.branch.update({
    where: {
      id: branchId,
    },

    data: {
      name: nextName,

      address: nextAddress,

      description: nextDescription,

      translations,

      ...(payload.phone !== undefined && {
        phone: payload.phone.trim(),
      }),

      ...(payload.imageObjectKey !== undefined && {
        imageObjectKey: payload.imageObjectKey,
      }),
    },
  });

  // =====================================================
  // 7. GENERATE SIGNED IMAGE URL
  // =====================================================

  const imageUrl = updatedBranch.imageObjectKey
    ? await uploadService.getImageUrl(updatedBranch.imageObjectKey)
    : null;

  // =====================================================
  // 8. LOCALIZE RESPONSE
  // =====================================================

  const localized = localizeBranch(updatedBranch, language);

  return {
    id: updatedBranch.id,

    name: localized.name,

    address: localized.address,

    phone: updatedBranch.phone,

    description: localized.description,

    imageObjectKey: updatedBranch.imageObjectKey,

    imageUrl,

    status: updatedBranch.status,

    createdAt: updatedBranch.createdAt,

    updatedAt: updatedBranch.updatedAt,
  };
};

// =====================================================
// UPDATE BRANCH STATUS
// =====================================================

const updateBranchStatus = async (
  branchId: string,
  payload: IUpdateBranchStatusPayload,
  userId: string,
) => {
  // =====================================================
  // 1. FIND BRANCH
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
    throw new AppError("Branch not found", 404);
  }

  // =====================================================
  // 2. SAME STATUS - NO UPDATE / NO NOTIFICATION
  // =====================================================

  if (branch.status === payload.status) {
    return branch;
  }

  // =====================================================
  // 3. UPDATE BRANCH STATUS + AUDIT + NOTIFICATIONS
  // =====================================================

  const updatedBranch = await prisma.$transaction(async (tx) => {
    // ===================================================
    // 3.1 ATOMIC STATUS UPDATE
    // ===================================================

    const claimResult = await tx.branch.updateMany({
      where: {
        id: branchId,
        status: branch.status,
      },

      data: {
        status: payload.status,
      },
    });

    if (claimResult.count !== 1) {
      throw new AppError("Branch status has changed. Please try again.", 409);
    }

    const result = await tx.branch.findUniqueOrThrow({
      where: {
        id: branchId,
      },
    });

    // ===================================================
    // 3.2 AUDIT LOG
    // ===================================================

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

    // ===================================================
    // 3.3 GET ACTIVE STAFF ASSIGNED TO THIS BRANCH
    // ===================================================

    const assignedStaff = await tx.staff.findMany({
      where: {
        status: StaffStatus.ACTIVE,

        branches: {
          some: {
            branchId,
          },
        },
      },

      select: {
        userId: true,
      },
    });

    // ===================================================
    // 3.4 GET BRANCH MANAGERS
    // ===================================================

    const branchManagers = await tx.branchManagerBranch.findMany({
      where: {
        branchId,
      },

      select: {
        userId: true,
      },
    });

    // ===================================================
    // 3.5 COLLECT STAFF + MANAGER USER IDS
    // ===================================================

    const recipientIds = new Set<string>();

    for (const staff of assignedStaff) {
      if (staff.userId) {
        recipientIds.add(staff.userId);
      }
    }

    for (const manager of branchManagers) {
      recipientIds.add(manager.userId);
    }

    // ===================================================
    // 3.6 NOTIFY STAFF + MANAGERS
    // ===================================================

    const isActive = result.status === BranchStatus.ACTIVE;

    const staffTranslations = notificationTemplates.BRANCH_STATUS_CHANGED(
      result.name,
      isActive,
    );

    for (const recipientId of recipientIds) {
      await notificationService.createNotification(
        {
          userId: recipientId,

          type: "BRANCH_STATUS_CHANGED",

          title: staffTranslations.en!.title!,

          message: staffTranslations.en!.message!,

          translations: staffTranslations,
        },
        tx,
      );
    }

    // ===================================================
    // 3.7 NOTIFY AFFECTED CUSTOMERS IF BRANCH INACTIVE
    // ===================================================

    if (result.status === BranchStatus.INACTIVE) {
      const now = new Date();

      const todayUTC = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
      );

      const affectedAppointments = await tx.appointment.findMany({
        where: {
          branchId,

          date: {
            gte: todayUTC,
          },

          appointmentStatus: {
            in: [
              AppointmentStatus.PENDING_PAYMENT,
              AppointmentStatus.RESERVED,
              AppointmentStatus.CONFIRMED,
            ],
          },
        },

        select: {
          customerId: true,
        },
      });

      // One notification per customer, not per appointment.

      const customerIds = new Set(
        affectedAppointments.map((appointment) => appointment.customerId),
      );

      const customerTranslations = notificationTemplates.BRANCH_UNAVAILABLE(
        result.name,
      );

      for (const customerId of customerIds) {
        await notificationService.createNotification(
          {
            userId: customerId,

            type: "BRANCH_UNAVAILABLE",

            title: customerTranslations.en!.title!,

            message: customerTranslations.en!.message!,

            translations: customerTranslations,
          },
          tx,
        );
      }
    }

    // ===================================================
    // 4. RETURN UPDATED BRANCH
    // ===================================================

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

  // =====================================================
  // 1. GET BRANCH BOOKING POLICY
  // =====================================================

  let bookingPolicy = await prisma.branchBookingPolicy.findUnique({
    where: {
      branchId,
    },
  });

  // =====================================================
  // 2. FALLBACK FOR OLD BRANCHES
  // =====================================================

  if (!bookingPolicy) {
    bookingPolicy = await prisma.branchBookingPolicy.upsert({
      where: {
        branchId,
      },

      update: {},

      create: {
        branchId,

        slotIntervalMinutes: 30,

        minimumBookingNoticeMinutes: 120,

        maximumAdvanceBookingDays: 30,

        cancellationCutoffHours: 12,

        rescheduleCutoffHours: 12,

        reserveExpiryRule: "APPOINTMENT_TIME",

        allowedBookingMethods: ["PAY_NOW", "DEPOSIT", "RESERVE_NOW"],

        depositEnabled: true,

        depositPercentage: 10,
      },
    });
  }

  // =====================================================
  // 3. DERIVE DEPOSIT AVAILABILITY
  // =====================================================

  const allowedBookingMethods = bookingPolicy.allowedBookingMethods;

  const depositEnabled = allowedBookingMethods.includes("DEPOSIT");

  // =====================================================
  // 4. RESPONSE
  // =====================================================

  return {
    slotIntervalMinutes: bookingPolicy.slotIntervalMinutes,

    minimumBookingNoticeMinutes: bookingPolicy.minimumBookingNoticeMinutes,

    maximumAdvanceBookingDays: bookingPolicy.maximumAdvanceBookingDays,

    cancellationCutoffHours: bookingPolicy.cancellationCutoffHours,

    rescheduleCutoffHours: bookingPolicy.rescheduleCutoffHours,

    reserveExpiryRule: bookingPolicy.reserveExpiryRule,

    allowedBookingMethods,

    // Backward-compatible response field
    depositEnabled,

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
  // =====================================================
  // 1. CHECK BRANCH
  // =====================================================

  const branch = await prisma.branch.findUnique({
    where: {
      id: branchId,
    },
  });

  if (!branch) {
    throw new AppError("Branch not found", 404);
  }

  // =====================================================
  // 2. VALIDATE ALLOWED BOOKING METHODS
  // =====================================================

  const validMethods = ["PAY_NOW", "DEPOSIT", "RESERVE_NOW"];

  if (
    !Array.isArray(payload.allowedBookingMethods) ||
    payload.allowedBookingMethods.length === 0 ||
    payload.allowedBookingMethods.some(
      (method) => !validMethods.includes(method),
    ) ||
    new Set(payload.allowedBookingMethods).size !==
      payload.allowedBookingMethods.length
  ) {
    throw new AppError(
      "At least one valid, unique booking method must be enabled",
      400,
    );
  }

  const depositEnabled = payload.allowedBookingMethods.includes("DEPOSIT");

  // =====================================================
  // 3. UPDATE POLICY + AUDIT LOG
  // =====================================================

  const result = await prisma.$transaction(async (tx) => {
    const existingPolicy = await tx.branchBookingPolicy.findUnique({
      where: {
        branchId,
      },
    });

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

        allowedBookingMethods: payload.allowedBookingMethods,

        depositEnabled,

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

        allowedBookingMethods: payload.allowedBookingMethods,

        depositEnabled,

        depositPercentage: payload.depositPercentage,
      },
    });

    // =====================================================
    // 4. AUDIT LOG
    // =====================================================

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

                allowedBookingMethods: existingPolicy.allowedBookingMethods,

                depositEnabled: existingPolicy.depositEnabled,

                depositPercentage:
                  existingPolicy.depositPercentage !== null
                    ? Number(existingPolicy.depositPercentage)
                    : null,
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

            allowedBookingMethods: updatedPolicy.allowedBookingMethods,

            depositEnabled: updatedPolicy.depositEnabled,

            depositPercentage:
              updatedPolicy.depositPercentage !== null
                ? Number(updatedPolicy.depositPercentage)
                : null,
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

const getBranchDailySummary = async (
  branchId: string,
  userId: string,
  role: Role,
  date: string,
): Promise<IBranchDailySummaryResult> => {
  // =====================================================
  // 1. CHECK ROLE
  // =====================================================

  if (role !== Role.BRAND_OWNER && role !== Role.BRANCH_MANAGER) {
    throw new AppError("You are not allowed to access branch reports", 403);
  }

  // =====================================================
  // 2. CHECK BRANCH
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
    throw new AppError("Branch not found", 404);
  }

  // =====================================================
  // 3. BRANCH MANAGER ACCESS CONTROL
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
      throw new AppError(
        "You are not allowed to access reports for this branch",
        403,
      );
    }
  }

  // =====================================================
  // 4. VALIDATE DATE
  // =====================================================

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new AppError("date must be in YYYY-MM-DD format", 400);
  }

  const reportDate = new Date(`${date}T00:00:00.000Z`);

  if (
    Number.isNaN(reportDate.getTime()) ||
    reportDate.toISOString().slice(0, 10) !== date
  ) {
    throw new AppError("Invalid date", 400);
  }

  // =====================================================
  // 5. FETCH APPOINTMENT STATUS COUNTS
  // =====================================================

  const groupedAppointments = await prisma.appointment.groupBy({
    by: ["appointmentStatus"],

    where: {
      branchId,
      date: reportDate,
    },

    _count: {
      _all: true,
    },
  });

  // =====================================================
  // 6. BUILD STATUS COUNT MAP
  // =====================================================

  const statusCounts = new Map<AppointmentStatus, number>();

  for (const group of groupedAppointments) {
    statusCounts.set(group.appointmentStatus, group._count._all);
  }

  const countStatus = (status: AppointmentStatus): number =>
    statusCounts.get(status) ?? 0;

  // =====================================================
  // 7. CALCULATE INDIVIDUAL STATUS COUNTS
  // =====================================================

  const pendingPayment = countStatus(AppointmentStatus.PENDING_PAYMENT);

  const reserved = countStatus(AppointmentStatus.RESERVED);

  const confirmed = countStatus(AppointmentStatus.CONFIRMED);

  const completed = countStatus(AppointmentStatus.COMPLETED);

  const cancelled = countStatus(AppointmentStatus.CANCELLED);

  const noShow = countStatus(AppointmentStatus.NO_SHOW);

  const expired = countStatus(AppointmentStatus.EXPIRED);

  // =====================================================
  // 8. CALCULATE TOTAL APPOINTMENTS
  // =====================================================

  const total = groupedAppointments.reduce(
    (sum, group) => sum + group._count._all,
    0,
  );

  // =====================================================
  // 9. CALCULATE PENDING APPOINTMENTS
  // =====================================================

  // Pending includes:
  // - PENDING_PAYMENT
  // - RESERVED
  // - CONFIRMED
  //
  // EXPIRED is NOT considered pending.

  const pending = pendingPayment + reserved + confirmed;

  // =====================================================
  // 10. CALCULATE COMPLETED APPOINTMENT REVENUE
  // =====================================================

  // Revenue definition:
  // Sum of appointment.price for COMPLETED appointments.
  //
  // GROUP_PURCHASE redemption appointments may have
  // price = 0 because payment happened earlier.
  //
  // This is completed booking value, not a full
  // payment-ledger / cash-flow report.

  const revenueAggregation = await prisma.appointment.aggregate({
    where: {
      branchId,
      date: reportDate,

      appointmentStatus: AppointmentStatus.COMPLETED,
    },

    _sum: {
      price: true,
    },
  });

  const revenue = Number(revenueAggregation._sum.price ?? 0);

  // =====================================================
  // 11. CALCULATE AVERAGE TICKET
  // =====================================================

  const averageTicket =
    completed > 0 ? Number((revenue / completed).toFixed(2)) : 0;

  // =====================================================
  // 12. RETURN DAILY SUMMARY
  // =====================================================

  return {
    date,

    total,
    completed,
    cancelled,
    noShow,
    pending,
    expired,

    statusBreakdown: {
      pendingPayment,
      reserved,
      confirmed,
      completed,
      cancelled,
      noShow,
      expired,
    },

    revenue: Number(revenue.toFixed(2)),
    averageTicket,
  };
};

const getBranchDailySeries = async (
  branchId: string,
  userId: string,
  role: Role,
  query: IBranchDailySeriesQuery,
): Promise<IBranchDailySeriesResult> => {
  // =====================================================
  // 1. CHECK ROLE
  // =====================================================

  if (role !== Role.BRAND_OWNER && role !== Role.BRANCH_MANAGER) {
    throw new AppError("You are not allowed to access branch reports", 403);
  }

  // =====================================================
  // 2. CHECK BRANCH
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
    throw new AppError("Branch not found", 404);
  }

  // =====================================================
  // 3. BRANCH MANAGER ACCESS CONTROL
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
      throw new AppError(
        "You are not allowed to access reports for this branch",
        403,
      );
    }
  }

  // =====================================================
  // 4. VALIDATE DATE RANGE
  // =====================================================

  const { start, end } = query;

  const isValidDate = (value: string): boolean => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return false;
    }

    const parsed = new Date(`${value}T00:00:00.000Z`);

    return (
      !Number.isNaN(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value
    );
  };

  if (!isValidDate(start) || !isValidDate(end)) {
    throw new AppError("Invalid date range. Use YYYY-MM-DD format", 400);
  }

  const startDate = new Date(`${start}T00:00:00.000Z`);
  const endDate = new Date(`${end}T00:00:00.000Z`);

  if (startDate > endDate) {
    throw new AppError(
      "end date must be greater than or equal to start date",
      400,
    );
  }

  const DAY_IN_MS = 24 * 60 * 60 * 1000;

  const totalDays =
    Math.round((endDate.getTime() - startDate.getTime()) / DAY_IN_MS) + 1;

  if (totalDays > 366) {
    throw new AppError("Date range cannot exceed 366 days", 400);
  }

  // =====================================================
  // 5. FETCH APPOINTMENT COUNTS BY DATE
  // =====================================================

  const groupedAppointments = await prisma.appointment.groupBy({
    by: ["date"],

    where: {
      branchId,

      date: {
        gte: startDate,
        lte: endDate,
      },
    },

    _count: {
      _all: true,
    },

    orderBy: {
      date: "asc",
    },
  });

  // =====================================================
  // 6. BUILD DATE -> COUNT MAP
  // =====================================================

  const appointmentCountMap = new Map<string, number>();

  for (const group of groupedAppointments) {
    const dateKey = group.date.toISOString().slice(0, 10);

    appointmentCountMap.set(dateKey, group._count._all);
  }

  // =====================================================
  // 7. GENERATE COMPLETE DAILY SERIES
  // =====================================================

  // Include dates without appointments as count = 0.
  // This makes frontend chart rendering easier.

  const items: IBranchDailySeriesResult["items"] = [];

  for (let dayIndex = 0; dayIndex < totalDays; dayIndex++) {
    const currentDate = new Date(startDate.getTime() + dayIndex * DAY_IN_MS);

    const dateKey = currentDate.toISOString().slice(0, 10);

    items.push({
      date: dateKey,
      count: appointmentCountMap.get(dateKey) ?? 0,
    });
  }

  // =====================================================
  // 8. RETURN RESULT
  // =====================================================

  return {
    items,
  };
};

const getBranchStaffOutput = async (
  branchId: string,
  userId: string,
  role: Role,
  query: IBranchStaffOutputQuery,
): Promise<IBranchStaffOutputResult> => {
  // =====================================================
  // 1. CHECK ROLE
  // =====================================================

  if (role !== Role.BRAND_OWNER && role !== Role.BRANCH_MANAGER) {
    throw new AppError("You are not allowed to access branch reports", 403);
  }

  // =====================================================
  // 2. CHECK BRANCH
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
    throw new AppError("Branch not found", 404);
  }

  // =====================================================
  // 3. BRANCH MANAGER ACCESS CONTROL
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
      throw new AppError(
        "You are not allowed to access reports for this branch",
        403,
      );
    }
  }

  // =====================================================
  // 4. VALIDATE DATE RANGE
  // =====================================================

  const { start, end } = query;

  const isValidDate = (value: string): boolean => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return false;
    }

    const parsed = new Date(`${value}T00:00:00.000Z`);

    return (
      !Number.isNaN(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value
    );
  };

  if (!isValidDate(start) || !isValidDate(end)) {
    throw new AppError("Invalid date range. Use YYYY-MM-DD format", 400);
  }

  const startDate = new Date(`${start}T00:00:00.000Z`);
  const endDate = new Date(`${end}T00:00:00.000Z`);

  if (startDate > endDate) {
    throw new AppError(
      "end date must be greater than or equal to start date",
      400,
    );
  }

  const DAY_IN_MS = 24 * 60 * 60 * 1000;

  const totalDays =
    Math.round((endDate.getTime() - startDate.getTime()) / DAY_IN_MS) + 1;

  if (totalDays > 366) {
    throw new AppError("Date range cannot exceed 366 days", 400);
  }

  // =====================================================
  // 5. FETCH APPOINTMENT COUNTS BY STAFF
  // =====================================================

  const appointmentGroups = await prisma.appointment.groupBy({
    by: ["staffId", "appointmentStatus"],

    where: {
      branchId,

      date: {
        gte: startDate,
        lte: endDate,
      },
    },

    _count: {
      _all: true,
    },

    _sum: {
      price: true,
    },
  });

  // =====================================================
  // 6. BUILD STAFF PERFORMANCE MAP
  // =====================================================

  const staffMap = new Map<
    string,
    {
      appointmentCount: number;
      completedCount: number;
      revenue: number;
    }
  >();

  for (const group of appointmentGroups) {
    const current = staffMap.get(group.staffId) ?? {
      appointmentCount: 0,
      completedCount: 0,
      revenue: 0,
    };

    current.appointmentCount += group._count._all;

    if (group.appointmentStatus === AppointmentStatus.COMPLETED) {
      current.completedCount += group._count._all;

      current.revenue += Number(group._sum.price ?? 0);
    }

    staffMap.set(group.staffId, current);
  }

  // =====================================================
  // 7. FETCH STAFF INFORMATION
  // =====================================================

  const staffIds = [...staffMap.keys()];

  if (staffIds.length === 0) {
    return {
      items: [],
    };
  }

  const staffRecords = await prisma.staff.findMany({
    where: {
      id: {
        in: staffIds,
      },
    },

    select: {
      id: true,
      name: true,
    },
  });

  const staffNameMap = new Map(
    staffRecords.map((staff) => [staff.id, staff.name]),
  );

  // =====================================================
  // 8. FETCH VISIBLE REVIEW RATINGS
  // =====================================================

  // Rating is based on reviews linked to appointments
  // completed within the selected date range.
  //
  // Only VISIBLE reviews are included.

  const reviewGroups = await prisma.review.groupBy({
    by: ["staffId"],

    where: {
      branchId,

      staffId: {
        in: staffIds,
      },

      moderationStatus: ReviewModerationStatus.VISIBLE,

      appointment: {
        date: {
          gte: startDate,
          lte: endDate,
        },

        appointmentStatus: AppointmentStatus.COMPLETED,
      },
    },

    _avg: {
      rating: true,
    },
  });

  const ratingMap = new Map<string, number | null>();

  for (const group of reviewGroups) {
    ratingMap.set(
      group.staffId,
      group._avg.rating === null ? null : Number(group._avg.rating.toFixed(2)),
    );
  }

  // =====================================================
  // 9. BUILD FINAL STAFF OUTPUT
  // =====================================================

  const items: IBranchStaffOutputResult["items"] = [];

  for (const [staffId, stats] of staffMap.entries()) {
    items.push({
      staffId,

      staffName: staffNameMap.get(staffId) ?? "Unknown Staff",

      appointmentCount: stats.appointmentCount,

      completedCount: stats.completedCount,

      revenue: Number(stats.revenue.toFixed(2)),

      averageRating: ratingMap.get(staffId) ?? null,
    });
  }

  // =====================================================
  // 10. SORT BY COMPLETED APPOINTMENTS
  // =====================================================

  items.sort((a, b) => {
    if (b.completedCount !== a.completedCount) {
      return b.completedCount - a.completedCount;
    }

    if (b.revenue !== a.revenue) {
      return b.revenue - a.revenue;
    }

    return a.staffName.localeCompare(b.staffName);
  });

  // =====================================================
  // 11. RETURN RESULT
  // =====================================================

  return {
    items,
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
  getBranchDailySummary,
  getBranchDailySeries,
  getBranchStaffOutput,
};
