import { getBrandInternationalSettings } from "../../utils/brand-international-settings.utils.js";
import { logUnexpectedError } from "../../utils/normalize-error.js";
import bcrypt from "bcrypt";
import crypto from "crypto";

import {
  AppointmentStatus,
  BranchStatus,
  DayOfWeek,
  ListingStatus,
  PackageStatus,
  PaymentStatus,
  Prisma,
  ReviewModerationStatus,
  Role,
  ServiceStatus,
  StaffStatus,
  StaffUnavailabilityType,
} from "../../../../generated/prisma/client.js";

import { prisma } from "../../lib/prisma.js";

import { AppError } from "../../utils/app-error.js";

import {
  IAssignStaffBranchesPayload,
  IAssignStaffPackagesPayload,
  IAssignStaffServicesPayload,
  ICreateStaffPayload,
  ICreateStaffUnavailabilityPayload,
  IMyStaffAppointmentsQuery,
  IStaffTranslations,
  IUpdateStaffPayload,
  IUpdateStaffSchedulePayload,
  IUpdateStaffStatusPayload,
  IUpdateStaffUnavailabilityPayload,
} from "./staff.interface.js";

import { auditLogService } from "../auditLog/auditLog.service.js";
import { uploadService } from "../upload/upload.service.js";
import { getLocalizedContent } from "../../utils/localization.js";
import { DEFAULT_LANGUAGE, Language } from "../../utils/language.js";
import { notificationService } from "../notification/notification.service.js";
import { notificationTemplates } from "../notification/notification.templates.js";

const readStaffTranslations = (value: unknown): IStaffTranslations => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as IStaffTranslations;
};

const buildStaffTranslations = (
  existing: unknown,
  incoming?: IStaffTranslations,
): IStaffTranslations => {
  const current = readStaffTranslations(existing);

  if (!incoming) {
    return current;
  }

  const result: IStaffTranslations = {
    ...current,
  };

  for (const language of ["en", "zh-CN", "zh-HK"] as const) {
    const update = incoming[language];

    if (!update) continue;

    result[language] = {
      ...(current[language] ?? {}),
      ...update,
    };
  }

  return result;
};

const localizeStaff = <
  T extends {
    roleTitle: string;
    specialization: string | null;
    description: string | null;
    translations: unknown;
  },
>(
  staff: T,
  language: Language,
) => {
  const localized = getLocalizedContent(staff.translations, language, {
    roleTitle: staff.roleTitle,
    specialization: staff.specialization ?? "",
    description: staff.description ?? "",
  });

  const { translations: _translations, ...rest } = staff;

  return {
    ...rest,
    roleTitle: localized.roleTitle,
    specialization: localized.specialization || null,
    description: localized.description || null,
  };
};

const localizeStaffSummary = <
  T extends {
    roleTitle: string;
    specialization: string | null;
    translations: unknown;
  },
>(
  staff: T,
  language: Language,
) => {
  const localized = getLocalizedContent(staff.translations, language, {
    roleTitle: staff.roleTitle,
    specialization: staff.specialization ?? "",
  });

  return {
    roleTitle: localized.roleTitle,
    specialization: localized.specialization || null,
  };
};

export const generateTemporaryPassword = () => {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const numbers = "23456789";
  const special = "!@#$%&*";

  const all = upper + lower + numbers + special;

  const chars = [
    upper[crypto.randomInt(upper.length)],
    lower[crypto.randomInt(lower.length)],
    numbers[crypto.randomInt(numbers.length)],
    special[crypto.randomInt(special.length)],
  ];

  while (chars.length < 16) {
    chars.push(all[crypto.randomInt(all.length)]);
  }

  return chars.sort(() => crypto.randomInt(3) - 1).join("");
};

const createStaff = async (
  payload: ICreateStaffPayload,
  requester: {
    userId: string;
    role: Role;
  },
  language: Language = DEFAULT_LANGUAGE,
) => {
  // =====================================================
  // 1. NORMALIZE EMAIL
  // =====================================================

  const email = payload.email.trim().toLowerCase();

  const uniqueBranchIds = [...new Set(payload.branchIds)];
  const uniqueServiceIds = [...new Set(payload.serviceIds)];
  const uniquePackageIds = [...new Set(payload.packageIds)];

  if (uniqueBranchIds.length !== payload.branchIds.length) {
    throw new AppError("Duplicate branch IDs are not allowed", 400);
  }

  if (uniqueServiceIds.length !== payload.serviceIds.length) {
    throw new AppError("Duplicate service IDs are not allowed", 400);
  }

  if (uniquePackageIds.length !== payload.packageIds.length) {
    throw new AppError("Duplicate package IDs are not allowed", 400);
  }

  // =====================================================
  // 2. CHECK EXISTING USER / STAFF
  // =====================================================

  const existingUser = await prisma.user.findUnique({
    where: {
      email,
    },
  });

  if (existingUser) {
    throw new AppError("A user with this email already exists", 409);
  }

  const existingStaff = await prisma.staff.findUnique({
    where: {
      email,
    },
  });

  if (existingStaff) {
    throw new AppError("A staff member with this email already exists", 409);
  }

  // =====================================================
  // 3. BRANCH VALIDATION
  // =====================================================

  const branches = await prisma.branch.findMany({
    where: {
      id: {
        in: uniqueBranchIds,
      },
    },

    select: {
      id: true,
      status: true,
    },
  });

  if (branches.length !== uniqueBranchIds.length) {
    throw new AppError("One or more branches do not exist", 404);
  }

  const inactiveBranch = branches.find(
    (branch) => branch.status !== BranchStatus.ACTIVE,
  );

  if (inactiveBranch) {
    throw new AppError("Staff cannot be assigned to an inactive branch", 400);
  }

  // =====================================================
  // 4. BRANCH MANAGER SCOPE CHECK
  // =====================================================

  if (requester.role === Role.BRANCH_MANAGER) {
    const managerBranches = await prisma.branchManagerBranch.findMany({
      where: {
        userId: requester.userId,
      },

      select: {
        branchId: true,
      },
    });

    const allowedBranchIds = new Set(
      managerBranches.map((item) => item.branchId),
    );

    const unauthorizedBranch = uniqueBranchIds.find(
      (branchId) => !allowedBranchIds.has(branchId),
    );

    if (unauthorizedBranch) {
      throw new AppError(
        "You are not allowed to create staff outside your assigned branch scope",
        403,
      );
    }

    if (uniqueBranchIds.length > 1) {
      throw new AppError(
        "Branch Manager cannot create cross-branch staff assignments",
        403,
      );
    }
  }

  // =====================================================
  // 5. SERVICE VALIDATION
  // =====================================================

  const services = await prisma.service.findMany({
    where: {
      id: {
        in: uniqueServiceIds,
      },
    },

    select: {
      id: true,
      status: true,

      branches: {
        select: {
          branchId: true,
        },
      },
    },
  });

  if (services.length !== uniqueServiceIds.length) {
    throw new AppError("One or more services do not exist", 404);
  }

  const inactiveService = services.find(
    (service) => service.status !== ServiceStatus.ACTIVE,
  );

  if (inactiveService) {
    throw new AppError("Inactive services cannot be assigned to staff", 400);
  }

  // Service must be available in an assigned branch.

  for (const service of services) {
    const serviceBranchIds = new Set(
      service.branches.map((item) => item.branchId),
    );

    const availableInAssignedBranch = uniqueBranchIds.some((branchId) =>
      serviceBranchIds.has(branchId),
    );

    if (!availableInAssignedBranch) {
      throw new AppError(
        "A selected service is not available in any assigned staff branch",
        400,
      );
    }
  }

  // =====================================================
  // 6. PACKAGE VALIDATION
  // =====================================================

  const packages = await prisma.package.findMany({
    where: {
      id: {
        in: uniquePackageIds,
      },
    },

    select: {
      id: true,
      status: true,

      branches: {
        select: {
          branchId: true,
        },
      },

      services: {
        select: {
          serviceId: true,
        },
      },
    },
  });

  if (packages.length !== uniquePackageIds.length) {
    throw new AppError("One or more packages do not exist", 404);
  }

  for (const packageData of packages) {
    if (packageData.status !== PackageStatus.ACTIVE) {
      throw new AppError("Inactive packages cannot be assigned to staff", 400);
    }

    const packageBranchIds = new Set(
      packageData.branches.map((item) => item.branchId),
    );

    const availableInAssignedBranch = uniqueBranchIds.some((branchId) =>
      packageBranchIds.has(branchId),
    );

    if (!availableInAssignedBranch) {
      throw new AppError(
        "A selected package is not available in any assigned staff branch",
        400,
      );
    }

    // Staff must support ALL services in the package.

    const missingService = packageData.services.find(
      (item) => !uniqueServiceIds.includes(item.serviceId),
    );

    if (missingService) {
      throw new AppError(
        "Staff must be eligible for all services included in an assigned package",
        400,
      );
    }
  }

  // =====================================================
  // 7. PREPARE MULTILINGUAL STAFF CONTENT
  // =====================================================

  const roleTitle = payload.roleTitle.trim();

  const specialization = payload.specialization?.trim() || null;

  const description = payload.description?.trim() || null;

  const staffTranslations = payload.translations
    ? buildStaffTranslations(null, payload.translations)
    : null;

  // =====================================================
  // 8. GENERATE TEMPORARY PASSWORD
  // =====================================================

  const temporaryPassword = generateTemporaryPassword();

  const passwordHash = await bcrypt.hash(temporaryPassword, 12);

  // =====================================================
  // 9. DATABASE TRANSACTION
  //
  // Creates:
  // - User account
  // - Staff profile
  // - Branch assignments
  // - Service assignments
  // - Package assignments
  //
  // All operations succeed or roll back together.
  // =====================================================

  const result = await prisma.$transaction(async (tx) => {
    // ---------------------------------------------
    // CREATE USER
    // ---------------------------------------------

    const user = await tx.user.create({
      data: {
        name: payload.name.trim(),

        email,

        phone: payload.phone?.trim() || null,

        passwordHash,

        role: Role.STAFF,

        mustChangePassword: true,
      },
    });

    // ---------------------------------------------
    // CREATE STAFF WITH TRANSLATIONS
    // ---------------------------------------------

    const staff = await tx.staff.create({
      data: {
        userId: user.id,

        name: payload.name.trim(),

        email,

        phone: payload.phone?.trim() || null,

        roleTitle,

        specialization,

        description,

        avatarObjectKey: payload.avatarObjectKey || null,

        translations: staffTranslations
          ? (staffTranslations as Prisma.InputJsonValue)
          : Prisma.JsonNull,
      },
    });

    // ---------------------------------------------
    // ASSIGN STAFF BRANCHES
    // ---------------------------------------------

    await tx.staffBranch.createMany({
      data: uniqueBranchIds.map((branchId) => ({
        staffId: staff.id,
        branchId,
      })),
    });

    // ---------------------------------------------
    // ASSIGN STAFF SERVICES
    // ---------------------------------------------

    if (uniqueServiceIds.length > 0) {
      await tx.staffService.createMany({
        data: uniqueServiceIds.map((serviceId) => ({
          staffId: staff.id,
          serviceId,
        })),
      });
    }

    // ---------------------------------------------
    // ASSIGN STAFF PACKAGES
    // ---------------------------------------------

    if (uniquePackageIds.length > 0) {
      await tx.staffPackage.createMany({
        data: uniquePackageIds.map((packageId) => ({
          staffId: staff.id,
          packageId,
        })),
      });
    }

    // ---------------------------------------------
    // RETURN STAFF + LINKED USER ID
    //
    // userId is needed for notification recipient.
    // ---------------------------------------------

    return staff;
  });

  // =====================================================
  // 10. MULTILINGUAL STAFF ACCOUNT NOTIFICATION
  //
  // Create only after successful database transaction.
  //
  // Recipient: result.userId, NOT result.id.
  // =====================================================

  try {
    const translations = notificationTemplates.STAFF_ACCOUNT_CREATED();

    await notificationService.createNotification({
      userId: result.userId,

      type: "STAFF_ACCOUNT_CREATED",

      title: translations.en!.title!,

      message: translations.en!.message!,

      translations,
    });
  } catch (error) {
    // Notification failure must not undo successful
    // staff account creation.

    logUnexpectedError(error, {
      source: "src/app/module/staff/staff.service.ts:547",
    });
  }

  // =====================================================
  // 11. LOCALIZE CREATED STAFF RESPONSE
  // =====================================================

  const localizedStaff = getLocalizedContent(result.translations, language, {
    roleTitle: result.roleTitle,
    specialization: result.specialization ?? "",
    description: result.description ?? "",
  });

  // =====================================================
  // 12. FINAL RESPONSE
  //
  // Preserve existing response structure.
  // =====================================================

  return {
    id: result.id,

    name: result.name,

    email: result.email,

    roleTitle: localizedStaff.roleTitle,

    specialization: localizedStaff.specialization || null,

    description: localizedStaff.description || null,

    translations: result.translations,

    branchIds: uniqueBranchIds,

    serviceIds: uniqueServiceIds,

    packageIds: uniquePackageIds,

    status: result.status,

    temporaryPassword,

    mustChangePassword: true,
  };
};

type ReviewSummary = {
  averageRating: number;
  totalReviews: number;
  ratingBreakdown: {
    5: number;
    4: number;
    3: number;
    2: number;
    1: number;
  };
};

const buildReviewSummary = (
  rows: Array<{
    staffId: string;
    rating: number;
    _count: { _all: number };
  }>,
): ReviewSummary => {
  const ratingBreakdown = {
    5: 0,
    4: 0,
    3: 0,
    2: 0,
    1: 0,
  };

  let totalReviews = 0;
  let totalRating = 0;

  for (const row of rows) {
    const rating = row.rating as 1 | 2 | 3 | 4 | 5;
    const count = row._count._all;

    if (rating >= 1 && rating <= 5) {
      ratingBreakdown[rating] += count;
      totalReviews += count;
      totalRating += rating * count;
    }
  }

  return {
    averageRating:
      totalReviews > 0 ? Math.round((totalRating / totalReviews) * 10) / 10 : 0,
    totalReviews,
    ratingBreakdown,
  };
};

const getStaff = async (
  query: Record<string, any>,
  requester: {
    userId: string;
    role: Role;
  },
  language: Language = DEFAULT_LANGUAGE,
) => {
  // =====================================================
  // 1. PAGINATION
  // =====================================================

  const page = query.page ? Number(query.page) : 1;
  const limit = query.limit ? Number(query.limit) : 20;

  if (!Number.isInteger(page) || page < 1) {
    throw new AppError("page must be at least 1", 400);
  }

  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new AppError("limit must be between 1 and 100", 400);
  }

  const skip = (page - 1) * limit;

  // =====================================================
  // 2. FILTERS
  // =====================================================

  const branchId = query.branchId as string | undefined;
  const status = query.status as StaffStatus | undefined;

  const andConditions: Prisma.StaffWhereInput[] = [];

  if (status) {
    andConditions.push({
      status,
    });
  }

  // =====================================================
  // 3. BRANCH MANAGER SCOPE
  // =====================================================

  if (requester.role === Role.BRANCH_MANAGER) {
    const managerBranches = await prisma.branchManagerBranch.findMany({
      where: {
        userId: requester.userId,
      },

      select: {
        branchId: true,
      },
    });

    const allowedBranchIds = managerBranches.map((item) => item.branchId);

    if (allowedBranchIds.length === 0) {
      return {
        items: [],
        pagination: {
          page,
          limit,
          total: 0,
          totalPages: 0,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      };
    }

    if (branchId && !allowedBranchIds.includes(branchId)) {
      throw new AppError(
        "You are not allowed to view staff outside your assigned branch scope",
        403,
      );
    }

    andConditions.push({
      branches: {
        some: {
          branchId: {
            in: branchId ? [branchId] : allowedBranchIds,
          },
        },
      },
    });
  }

  // =====================================================
  // 4. BRAND OWNER BRANCH FILTER
  // =====================================================

  if (requester.role === Role.BRAND_OWNER && branchId) {
    andConditions.push({
      branches: {
        some: {
          branchId,
        },
      },
    });
  }

  const where: Prisma.StaffWhereInput = {
    AND: andConditions,
  };

  // =====================================================
  // 5. FETCH STAFF + COUNT
  // =====================================================

  const [staffList, total] = await Promise.all([
    prisma.staff.findMany({
      where,
      skip,
      take: limit,

      orderBy: {
        createdAt: "desc",
      },

      include: {
        branches: {
          include: {
            branch: {
              select: {
                id: true,
                name: true,
                translations: true,
              },
            },
          },
        },

        services: {
          include: {
            service: {
              select: {
                id: true,
                name: true,
                translations: true,
              },
            },
          },
        },

        packages: {
          include: {
            package: {
              select: {
                id: true,
                name: true,
                type: true,
                translations: true,
              },
            },
          },
        },
      },
    }),

    prisma.staff.count({
      where,
    }),
  ]);

  // =====================================================
  // 6. FETCH VISIBLE REVIEW SUMMARY
  // =====================================================

  const staffIds = staffList.map((staff) => staff.id);

  const reviewGroups =
    staffIds.length > 0
      ? await prisma.review.groupBy({
          by: ["staffId", "rating"],

          where: {
            staffId: {
              in: staffIds,
            },

            moderationStatus: ReviewModerationStatus.VISIBLE,

            ...(branchId && {
              branchId,
            }),
          },

          _count: {
            _all: true,
          },
        })
      : [];

  // =====================================================
  // 7. BUILD REVIEW SUMMARY MAP
  // =====================================================

  const reviewSummaryMap = new Map<string, ReviewSummary>();

  const reviewGroupsByStaff = new Map<string, typeof reviewGroups>();

  for (const group of reviewGroups) {
    const existingGroups = reviewGroupsByStaff.get(group.staffId) ?? [];

    existingGroups.push(group);

    reviewGroupsByStaff.set(group.staffId, existingGroups);
  }

  for (const staffId of staffIds) {
    reviewSummaryMap.set(
      staffId,
      buildReviewSummary(reviewGroupsByStaff.get(staffId) ?? []),
    );
  }

  // =====================================================
  // 8. LOCALIZED RESPONSE + SIGNED AVATAR URLS
  // =====================================================

  const items = await Promise.all(
    staffList.map(async (staff) => {
      const avatarUrl = staff.avatarObjectKey
        ? await uploadService.getImageUrl(staff.avatarObjectKey)
        : null;

      // ---------------------------------------------
      // LOCALIZE STAFF
      // ---------------------------------------------

      const localizedStaff = getLocalizedContent(staff.translations, language, {
        roleTitle: staff.roleTitle,
        specialization: staff.specialization,
        description: staff.description,
      });

      // ---------------------------------------------
      // RESPONSE
      // ---------------------------------------------

      return {
        id: staff.id,

        name: staff.name,

        email: staff.email,

        phone: staff.phone,

        roleTitle: localizedStaff.roleTitle,

        specialization: localizedStaff.specialization,

        description: localizedStaff.description,

        avatarObjectKey: staff.avatarObjectKey,

        avatarUrl,

        status: staff.status,

        reviewSummary: reviewSummaryMap.get(staff.id) ?? buildReviewSummary([]),

        // -----------------------------------------
        // LOCALIZED BRANCHES
        // -----------------------------------------

        branches: staff.branches.map((item) => {
          const localizedBranch = getLocalizedContent(
            item.branch.translations,
            language,
            {
              name: item.branch.name,
            },
          );

          return {
            id: item.branch.id,
            name: localizedBranch.name,
          };
        }),

        // -----------------------------------------
        // LOCALIZED SERVICES
        // -----------------------------------------

        services: staff.services.map((item) => {
          const localizedService = getLocalizedContent(
            item.service.translations,
            language,
            {
              name: item.service.name,
            },
          );

          return {
            id: item.service.id,
            name: localizedService.name,
          };
        }),

        // -----------------------------------------
        // LOCALIZED PACKAGES
        // -----------------------------------------

        packages: staff.packages.map((item) => {
          const localizedPackage = getLocalizedContent(
            item.package.translations,
            language,
            {
              name: item.package.name,
            },
          );

          return {
            id: item.package.id,
            name: localizedPackage.name,
            type: item.package.type,
          };
        }),
      };
    }),
  );

  // =====================================================
  // 9. PAGINATION
  // =====================================================

  const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

  // =====================================================
  // 10. FINAL RESPONSE
  // =====================================================

  return {
    items,

    pagination: {
      page,
      limit,
      total,
      totalPages,

      hasNextPage: page < totalPages,

      hasPreviousPage: page > 1,
    },
  };
};

const getStaffById = async (
  staffId: string,
  requester: {
    userId: string;
    role: Role;
  },
  language: Language = DEFAULT_LANGUAGE,
) => {
  // =====================================================
  // 1. FIND STAFF
  // =====================================================

  const staff = await prisma.staff.findUnique({
    where: {
      id: staffId,
    },

    include: {
      branches: {
        include: {
          branch: {
            select: {
              id: true,
              name: true,
              translations: true,
              status: true,
            },
          },
        },
      },

      services: {
        include: {
          service: {
            select: {
              id: true,
              name: true,
              translations: true,
              price: true,
              durationMinutes: true,
              status: true,
            },
          },
        },
      },

      packages: {
        include: {
          package: {
            select: {
              id: true,
              name: true,
              translations: true,
              type: true,
              packagePrice: true,
              durationMinutes: true,
              status: true,
              listingStatus: true,
            },
          },
        },
      },
    },
  });

  if (!staff) {
    throw new AppError("Staff not found", 404);
  }

  // =====================================================
  // 2. BRANCH MANAGER SCOPE CHECK
  // =====================================================

  if (requester.role === Role.BRANCH_MANAGER) {
    const managerBranches = await prisma.branchManagerBranch.findMany({
      where: {
        userId: requester.userId,
      },

      select: {
        branchId: true,
      },
    });

    const allowedBranchIds = new Set(
      managerBranches.map((item) => item.branchId),
    );

    const staffBranchIds = staff.branches.map((item) => item.branchId);

    const hasAccess = staffBranchIds.some((branchId) =>
      allowedBranchIds.has(branchId),
    );

    if (!hasAccess) {
      throw new AppError("You are not allowed to view this staff member", 403);
    }
  }

  // =====================================================
  // 3. FETCH STAFF REVIEW SUMMARY
  // =====================================================

  const reviewGroups = await prisma.review.groupBy({
    by: ["staffId", "rating"],

    where: {
      staffId,

      moderationStatus: ReviewModerationStatus.VISIBLE,
    },

    _count: {
      _all: true,
    },
  });

  const reviewSummary = buildReviewSummary(reviewGroups);

  // =====================================================
  // 4. SIGNED AVATAR URL
  // =====================================================

  const avatarUrl = staff.avatarObjectKey
    ? await uploadService.getImageUrl(staff.avatarObjectKey)
    : null;

  // =====================================================
  // 5. LOCALIZE STAFF FIELDS
  // =====================================================

  const localizedStaff = getLocalizedContent(staff.translations, language, {
    roleTitle: staff.roleTitle,
    specialization: staff.specialization ?? "",
    description: staff.description ?? "",
  });

  // =====================================================
  // 6. LOCALIZE RELATED BRANCHES
  // =====================================================

  const branches = staff.branches.map((item) => {
    const localizedBranch = getLocalizedContent(
      item.branch.translations,
      language,
      {
        name: item.branch.name,
      },
    );

    return {
      id: item.branch.id,
      name: localizedBranch.name,
      status: item.branch.status,
    };
  });

  // =====================================================
  // 7. LOCALIZE RELATED SERVICES
  // =====================================================

  const services = staff.services.map((item) => {
    const localizedService = getLocalizedContent(
      item.service.translations,
      language,
      {
        name: item.service.name,
      },
    );

    return {
      id: item.service.id,
      name: localizedService.name,
      price: Number(item.service.price),
      durationMinutes: item.service.durationMinutes,
      status: item.service.status,
    };
  });

  // =====================================================
  // 8. LOCALIZE RELATED PACKAGES
  // =====================================================

  const packages = staff.packages.map((item) => {
    const localizedPackage = getLocalizedContent(
      item.package.translations,
      language,
      {
        name: item.package.name,
      },
    );

    return {
      id: item.package.id,
      name: localizedPackage.name,
      type: item.package.type,
      packagePrice: Number(item.package.packagePrice),
      durationMinutes: item.package.durationMinutes,
      status: item.package.status,
      listingStatus: item.package.listingStatus,
    };
  });

  // =====================================================
  // 9. FINAL RESPONSE
  // =====================================================

  return {
    id: staff.id,

    name: staff.name,

    email: staff.email,

    phone: staff.phone,

    // Selected language
    roleTitle: localizedStaff.roleTitle,

    specialization: localizedStaff.specialization || null,

    description: localizedStaff.description || null,

    // All saved translations
    translations: staff.translations,

    avatarObjectKey: staff.avatarObjectKey,

    avatarUrl,

    status: staff.status,

    reviewSummary,

    branches,

    services,

    packages,

    createdAt: staff.createdAt,

    updatedAt: staff.updatedAt,
  };
};

const updateStaff = async (
  staffId: string,
  payload: IUpdateStaffPayload,
  requester: {
    userId: string;
    role: Role;
  },
  language: Language = DEFAULT_LANGUAGE,
) => {
  // =====================================================
  // 1. FIND STAFF
  // =====================================================

  const staff = await prisma.staff.findUnique({
    where: {
      id: staffId,
    },
    include: {
      branches: {
        select: {
          branchId: true,
        },
      },
    },
  });

  if (!staff) {
    throw new AppError("Staff not found", 404);
  }

  // =====================================================
  // 2. BRANCH MANAGER SCOPE CHECK
  // =====================================================

  if (requester.role === Role.BRANCH_MANAGER) {
    const managerBranches = await prisma.branchManagerBranch.findMany({
      where: {
        userId: requester.userId,
      },
      select: {
        branchId: true,
      },
    });

    const allowedBranchIds = new Set(
      managerBranches.map((item) => item.branchId),
    );

    const hasAccess = staff.branches.some((item) =>
      allowedBranchIds.has(item.branchId),
    );

    if (!hasAccess) {
      throw new AppError(
        "You are not allowed to update this staff member",
        403,
      );
    }
  }

  // =====================================================
  // 3. AVATAR R2 VALIDATION
  // =====================================================

  if (payload.avatarObjectKey !== undefined) {
    const expectedPrefix = `staff/${staffId}/`;

    if (!payload.avatarObjectKey.startsWith(expectedPrefix)) {
      throw new AppError("Invalid staff avatar object key", 400);
    }

    await uploadService.verifyImageExists(payload.avatarObjectKey);
  }

  // =====================================================
  // 4. PREPARE BASE FIELDS
  // =====================================================

  const nextRoleTitle =
    payload.roleTitle !== undefined
      ? payload.roleTitle.trim()
      : staff.roleTitle;

  const nextSpecialization =
    payload.specialization !== undefined
      ? payload.specialization.trim()
      : staff.specialization;

  const nextDescription =
    payload.description !== undefined
      ? payload.description.trim()
      : staff.description;

  // =====================================================
  // 5. PREPARE MULTILINGUAL TRANSLATIONS
  // =====================================================

  type LocaleFields = {
    roleTitle?: string;
    specialization?: string;
    description?: string;
  };

  type LocaleCode = "en" | "zh-CN" | "zh-HK";

  const hasTranslationChanges =
    payload.translations !== undefined ||
    payload.roleTitle !== undefined ||
    payload.specialization !== undefined ||
    payload.description !== undefined;

  // Convert existing Prisma JSON safely into a locale object.
  const readLocale = (value: Prisma.JsonValue | undefined): LocaleFields => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {};
    }

    return {
      ...(typeof value.roleTitle === "string" && {
        roleTitle: value.roleTitle,
      }),
      ...(typeof value.specialization === "string" && {
        specialization: value.specialization,
      }),
      ...(typeof value.description === "string" && {
        description: value.description,
      }),
    };
  };

  const existingJson =
    staff.translations &&
    typeof staff.translations === "object" &&
    !Array.isArray(staff.translations)
      ? staff.translations
      : null;

  const existingEn = readLocale(existingJson?.en);
  const existingZhCN = readLocale(existingJson?.["zh-CN"]);
  const existingZhHK = readLocale(existingJson?.["zh-HK"]);

  // Merge each field separately to preserve partial updates.
  const mergeLocale = (
    existing: LocaleFields,
    incoming?: LocaleFields,
  ): LocaleFields => ({
    ...existing,
    ...(incoming?.roleTitle !== undefined && {
      roleTitle: incoming.roleTitle.trim(),
    }),
    ...(incoming?.specialization !== undefined && {
      specialization: incoming.specialization.trim(),
    }),
    ...(incoming?.description !== undefined && {
      description: incoming.description.trim(),
    }),
  });

  const incomingTranslations = payload.translations;

  const mergedEn = mergeLocale(existingEn, incomingTranslations?.en);

  const mergedZhCN = mergeLocale(existingZhCN, incomingTranslations?.["zh-CN"]);

  const mergedZhHK = mergeLocale(existingZhHK, incomingTranslations?.["zh-HK"]);

  // Explicit base fields take priority over translations.en.
  const finalEn: LocaleFields = {
    ...mergedEn,

    roleTitle:
      payload.roleTitle !== undefined
        ? nextRoleTitle
        : (mergedEn.roleTitle ?? staff.roleTitle),

    specialization:
      payload.specialization !== undefined
        ? (nextSpecialization ?? "")
        : (mergedEn.specialization ?? staff.specialization ?? ""),

    description:
      payload.description !== undefined
        ? (nextDescription ?? "")
        : (mergedEn.description ?? staff.description ?? ""),
  };

  // Build JSON objects without assigning to readonly
  // Prisma.InputJsonObject properties.
  const toJsonLocale = (locale: LocaleFields): Prisma.InputJsonObject => ({
    ...(locale.roleTitle !== undefined && {
      roleTitle: locale.roleTitle,
    }),
    ...(locale.specialization !== undefined && {
      specialization: locale.specialization,
    }),
    ...(locale.description !== undefined && {
      description: locale.description,
    }),
  });

  const hasZhCN =
    existingJson?.["zh-CN"] !== undefined ||
    incomingTranslations?.["zh-CN"] !== undefined;

  const hasZhHK =
    existingJson?.["zh-HK"] !== undefined ||
    incomingTranslations?.["zh-HK"] !== undefined;

  const finalTranslations: Prisma.InputJsonObject = {
    en: toJsonLocale(finalEn),

    ...(hasZhCN && {
      "zh-CN": toJsonLocale(mergedZhCN),
    }),

    ...(hasZhHK && {
      "zh-HK": toJsonLocale(mergedZhHK),
    }),
  };

  // =====================================================
  // 6. UPDATE STAFF + USER PROFILE
  // =====================================================

  const updatedStaff = await prisma.$transaction(async (tx) => {
    const updated = await tx.staff.update({
      where: {
        id: staffId,
      },

      data: {
        ...(payload.name !== undefined && {
          name: payload.name.trim(),
        }),

        ...(payload.phone !== undefined && {
          phone: payload.phone.trim(),
        }),

        ...(payload.roleTitle !== undefined && {
          roleTitle: nextRoleTitle,
        }),

        ...(payload.specialization !== undefined && {
          specialization: nextSpecialization,
        }),

        ...(payload.description !== undefined && {
          description: nextDescription,
        }),

        ...(payload.avatarObjectKey !== undefined && {
          avatarObjectKey: payload.avatarObjectKey,
        }),

        ...(hasTranslationChanges && {
          translations: finalTranslations,
        }),
      },
    });

    // Keep linked User profile consistent.
    await tx.user.update({
      where: {
        id: staff.userId,
      },

      data: {
        ...(payload.name !== undefined && {
          name: payload.name.trim(),
        }),

        ...(payload.phone !== undefined && {
          phone: payload.phone.trim(),
        }),
      },
    });

    return updated;
  });

  // =====================================================
  // 7. SIGNED AVATAR URL
  // =====================================================

  const avatarUrl = updatedStaff.avatarObjectKey
    ? await uploadService.getImageUrl(updatedStaff.avatarObjectKey)
    : null;

  // =====================================================
  // 8. LOCALIZE RESPONSE
  // =====================================================

  const localizedStaff = getLocalizedContent(
    updatedStaff.translations,
    language,
    {
      roleTitle: updatedStaff.roleTitle,
      specialization: updatedStaff.specialization ?? "",
      description: updatedStaff.description ?? "",
    },
  );

  // =====================================================
  // 9. FINAL RESPONSE
  // =====================================================

  return {
    id: updatedStaff.id,

    name: updatedStaff.name,

    phone: updatedStaff.phone,

    roleTitle: localizedStaff.roleTitle,

    specialization: localizedStaff.specialization || null,

    description: localizedStaff.description || null,

    translations: updatedStaff.translations,

    avatarObjectKey: updatedStaff.avatarObjectKey,

    avatarUrl,

    status: updatedStaff.status,
  };
};

const updateStaffStatus = async (
  staffId: string,
  payload: IUpdateStaffStatusPayload,
  requester: {
    userId: string;
    role: Role;
  },
) => {
  // =====================================================
  // 1. FIND STAFF
  // =====================================================

  const staff = await prisma.staff.findUnique({
    where: {
      id: staffId,
    },

    include: {
      branches: {
        select: {
          branchId: true,
        },
      },
    },
  });

  if (!staff) {
    throw new AppError("Staff not found", 404);
  }

  // =====================================================
  // 2. BRANCH MANAGER SCOPE CHECK
  // =====================================================

  if (requester.role === Role.BRANCH_MANAGER) {
    const managerBranches = await prisma.branchManagerBranch.findMany({
      where: {
        userId: requester.userId,
      },

      select: {
        branchId: true,
      },
    });

    const allowedBranchIds = new Set(
      managerBranches.map((item) => item.branchId),
    );

    const hasAccess = staff.branches.some((item) =>
      allowedBranchIds.has(item.branchId),
    );

    if (!hasAccess) {
      throw new AppError(
        "You are not allowed to update this staff member",
        403,
      );
    }
  }

  // =====================================================
  // 3. SAME STATUS - NO UPDATE / NO NOTIFICATION
  // =====================================================

  if (staff.status === payload.status) {
    return {
      id: staff.id,
      status: staff.status,
    };
  }

  // =====================================================
  // 4. UPDATE STAFF STATUS + AUDIT LOG
  // =====================================================

  const updatedStaff = await prisma.$transaction(async (tx) => {
    const result = await tx.staff.update({
      where: {
        id: staffId,
      },

      data: {
        status: payload.status,
      },

      select: {
        id: true,
        userId: true,
        status: true,
      },
    });

    await auditLogService.createAuditLog(
      {
        userId: requester.userId,

        action: "STAFF_STATUS_CHANGED",

        entityType: "STAFF",

        entityId: staffId,

        metadata: {
          previousStatus: staff.status,
          newStatus: result.status,
          performedByRole: requester.role,
        },
      },
      tx,
    );

    return result;
  });

  // =====================================================
  // 5. MULTILINGUAL STATUS CHANGE NOTIFICATION
  //
  // Send only after successful transaction.
  // Recipient is Staff.userId, not Staff.id.
  // =====================================================

  if (updatedStaff.userId) {
    try {
      const isActivated = updatedStaff.status === StaffStatus.ACTIVE;

      const translations = isActivated
        ? notificationTemplates.STAFF_ACTIVATED()
        : notificationTemplates.STAFF_DEACTIVATED();

      await notificationService.createNotification({
        userId: updatedStaff.userId,

        type: isActivated ? "STAFF_ACTIVATED" : "STAFF_DEACTIVATED",

        title: translations.en!.title!,

        message: translations.en!.message!,

        translations,
      });
    } catch (error) {
      // Notification failure must not undo
      // a successful staff status update.

      logUnexpectedError(error, {
        source: "src/app/module/staff/staff.service.ts:1717",
      });
    }
  }

  // =====================================================
  // 6. RESPONSE
  // =====================================================

  return {
    id: updatedStaff.id,
    status: updatedStaff.status,
  };
};

const assignStaffBranches = async (
  staffId: string,
  payload: IAssignStaffBranchesPayload,
  requester: {
    userId: string;
    role: Role;
  },
) => {
  // =====================================================
  // 1. FIND STAFF WITH EXISTING ASSIGNMENTS
  // =====================================================

  const staff = await prisma.staff.findUnique({
    where: {
      id: staffId,
    },

    include: {
      services: {
        include: {
          service: {
            select: {
              id: true,

              branches: {
                select: {
                  branchId: true,
                },
              },
            },
          },
        },
      },

      packages: {
        include: {
          package: {
            select: {
              id: true,

              branches: {
                select: {
                  branchId: true,
                },
              },
            },
          },
        },
      },

      branches: {
        select: {
          branchId: true,
        },
      },
    },
  });

  if (!staff) {
    throw new AppError("Staff not found", 404);
  }

  // =====================================================
  // 2. VALIDATE DUPLICATE BRANCH IDS
  // =====================================================

  const uniqueBranchIds = [...new Set(payload.branchIds)];

  if (uniqueBranchIds.length !== payload.branchIds.length) {
    throw new AppError("Duplicate branch IDs are not allowed", 400);
  }

  // =====================================================
  // 3. VALIDATE BRANCH EXISTENCE + STATUS
  // =====================================================

  const branches = await prisma.branch.findMany({
    where: {
      id: {
        in: uniqueBranchIds,
      },
    },

    select: {
      id: true,
      status: true,
    },
  });

  if (branches.length !== uniqueBranchIds.length) {
    throw new AppError("One or more branches do not exist", 404);
  }

  const inactiveBranch = branches.find(
    (branch) => branch.status !== BranchStatus.ACTIVE,
  );

  if (inactiveBranch) {
    throw new AppError("Staff cannot be assigned to an inactive branch", 400);
  }

  // =====================================================
  // 4. BRANCH MANAGER SCOPE CHECK
  // =====================================================

  if (requester.role === Role.BRANCH_MANAGER) {
    const managerBranches = await prisma.branchManagerBranch.findMany({
      where: {
        userId: requester.userId,
      },

      select: {
        branchId: true,
      },
    });

    const allowedBranchIds = new Set(
      managerBranches.map((item) => item.branchId),
    );

    // Manager must already have access to this staff.

    const hasCurrentAccess = staff.branches.some((item) =>
      allowedBranchIds.has(item.branchId),
    );

    if (!hasCurrentAccess) {
      throw new AppError(
        "You are not allowed to manage this staff member",
        403,
      );
    }

    // Manager cannot assign outside own scope.

    const unauthorizedBranch = uniqueBranchIds.find(
      (branchId) => !allowedBranchIds.has(branchId),
    );

    if (unauthorizedBranch) {
      throw new AppError(
        "You are not allowed to assign staff outside your branch scope",
        403,
      );
    }

    // Manager cannot perform cross-branch reassignment.

    if (uniqueBranchIds.length > 1) {
      throw new AppError(
        "Branch Manager cannot assign staff across multiple branches",
        403,
      );
    }
  }

  // =====================================================
  // 5. VALIDATE EXISTING SERVICE ASSIGNMENTS
  //
  // Every assigned service must be available
  // in at least one of the final staff branches.
  // =====================================================

  for (const staffService of staff.services) {
    const serviceBranchIds = new Set(
      staffService.service.branches.map((item) => item.branchId),
    );

    const availableInNewBranchSet = uniqueBranchIds.some((branchId) =>
      serviceBranchIds.has(branchId),
    );

    if (!availableInNewBranchSet) {
      throw new AppError(
        "An assigned service is not available in any selected staff branch",
        400,
      );
    }
  }

  // =====================================================
  // 6. VALIDATE EXISTING PACKAGE ASSIGNMENTS
  //
  // Every assigned package must be available
  // in at least one final staff branch.
  // =====================================================

  for (const staffPackage of staff.packages) {
    const packageBranchIds = new Set(
      staffPackage.package.branches.map((item) => item.branchId),
    );

    const availableInNewBranchSet = uniqueBranchIds.some((branchId) =>
      packageBranchIds.has(branchId),
    );

    if (!availableInNewBranchSet) {
      throw new AppError(
        "An assigned package is not available in any selected staff branch",
        400,
      );
    }
  }

  // =====================================================
  // 7. DETECT ACTUAL BRANCH ASSIGNMENT CHANGES
  // =====================================================

  const currentBranchIds = staff.branches.map((item) => item.branchId);

  const currentBranchSet = new Set(currentBranchIds);
  const newBranchSet = new Set(uniqueBranchIds);

  const addedBranchIds = uniqueBranchIds.filter(
    (branchId) => !currentBranchSet.has(branchId),
  );

  const removedBranchIds = currentBranchIds.filter(
    (branchId) => !newBranchSet.has(branchId),
  );

  const hasChanges = addedBranchIds.length > 0 || removedBranchIds.length > 0;

  // =====================================================
  // 8. NO CHANGE - SKIP DATABASE WRITE + NOTIFICATION
  // =====================================================

  if (!hasChanges) {
    return {
      staffId,
      branchIds: uniqueBranchIds,
    };
  }

  // =====================================================
  // 9. REPLACE STAFF BRANCH ASSIGNMENTS ATOMICALLY
  // =====================================================

  await prisma.$transaction(async (tx) => {
    await tx.staffBranch.deleteMany({
      where: {
        staffId,
      },
    });

    if (uniqueBranchIds.length > 0) {
      await tx.staffBranch.createMany({
        data: uniqueBranchIds.map((branchId) => ({
          staffId,
          branchId,
        })),
      });
    }
  });

  // =====================================================
  // 10. MULTILINGUAL BRANCH ASSIGNMENT NOTIFICATION
  //
  // Recipient: Staff.userId
  // Only after successful transaction.
  // =====================================================

  if (staff.userId) {
    try {
      const translations =
        notificationTemplates.STAFF_BRANCH_ASSIGNMENT_UPDATED();

      await notificationService.createNotification({
        userId: staff.userId,

        type: "STAFF_BRANCH_ASSIGNMENT_UPDATED",

        title: translations.en!.title!,

        message: translations.en!.message!,

        translations,
      });
    } catch (error) {
      logUnexpectedError(error, {
        source: "src/app/module/staff/staff.service.ts:2010",
      });
    }
  }

  // =====================================================
  // 11. RESPONSE - EXISTING STRUCTURE PRESERVED
  // =====================================================

  return {
    staffId,
    branchIds: uniqueBranchIds,
  };
};

const assignStaffServices = async (
  staffId: string,
  payload: IAssignStaffServicesPayload,
  requester: {
    userId: string;
    role: Role;
  },
) => {
  const staff = await prisma.staff.findUnique({
    where: {
      id: staffId,
    },

    include: {
      branches: {
        select: {
          branchId: true,
        },
      },

      packages: {
        include: {
          package: {
            select: {
              id: true,
              name: true,

              services: {
                select: {
                  serviceId: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!staff) {
    throw new AppError("Staff not found", 404);
  }

  const uniqueServiceIds = [...new Set(payload.serviceIds)];

  if (uniqueServiceIds.length !== payload.serviceIds.length) {
    throw new AppError("Duplicate service IDs are not allowed", 400);
  }

  const staffBranchIds = new Set(staff.branches.map((item) => item.branchId));

  let managerBranchIds: Set<string> | null = null;

  // Branch Manager scope
  if (requester.role === Role.BRANCH_MANAGER) {
    const managerBranches = await prisma.branchManagerBranch.findMany({
      where: {
        userId: requester.userId,
      },

      select: {
        branchId: true,
      },
    });

    managerBranchIds = new Set(managerBranches.map((item) => item.branchId));

    const hasAccessToStaff = staff.branches.some((item) =>
      managerBranchIds!.has(item.branchId),
    );

    if (!hasAccessToStaff) {
      throw new AppError(
        "You are not allowed to manage this staff member",
        403,
      );
    }
  }

  // Empty list is allowed:
  // owner/manager can remove all service assignments
  if (uniqueServiceIds.length === 0) {
    if (staff.packages.length > 0) {
      throw new AppError(
        "Cannot remove all services while packages are assigned to this staff member",
        400,
      );
    }

    await prisma.staffService.deleteMany({
      where: {
        staffId,
      },
    });

    return {
      staffId,
      serviceIds: [],
    };
  }

  const services = await prisma.service.findMany({
    where: {
      id: {
        in: uniqueServiceIds,
      },
    },

    select: {
      id: true,
      name: true,
      status: true,

      branches: {
        select: {
          branchId: true,
        },
      },
    },
  });

  if (services.length !== uniqueServiceIds.length) {
    throw new AppError("One or more services do not exist", 404);
  }

  // Validate every selected service
  for (const service of services) {
    if (service.status !== ServiceStatus.ACTIVE) {
      throw new AppError(
        `Inactive service cannot be assigned: ${service.name}`,
        400,
      );
    }

    const serviceBranchIds = new Set(
      service.branches.map((item) => item.branchId),
    );

    // Service must overlap with at least one staff branch
    const availableInStaffBranch = [...staffBranchIds].some((branchId) =>
      serviceBranchIds.has(branchId),
    );

    if (!availableInStaffBranch) {
      throw new AppError(
        `Service "${service.name}" is not available in any branch assigned to this staff member`,
        400,
      );
    }

    // Extra manager-scope rule
    if (requester.role === Role.BRANCH_MANAGER && managerBranchIds) {
      const availableInsideManagerScope = [...staffBranchIds].some(
        (branchId) =>
          managerBranchIds!.has(branchId) && serviceBranchIds.has(branchId),
      );

      if (!availableInsideManagerScope) {
        throw new AppError(
          `You cannot assign service "${service.name}" outside your branch scope`,
          403,
        );
      }
    }
  }

  // Existing package assignments must remain valid
  for (const staffPackage of staff.packages) {
    const requiredServiceIds = staffPackage.package.services.map(
      (item) => item.serviceId,
    );

    const missingServiceId = requiredServiceIds.find(
      (serviceId) => !uniqueServiceIds.includes(serviceId),
    );

    if (missingServiceId) {
      throw new AppError(
        `Cannot remove a service required by assigned package "${staffPackage.package.name}"`,
        400,
      );
    }
  }

  // Replace old service assignments atomically
  await prisma.$transaction(async (tx) => {
    await tx.staffService.deleteMany({
      where: {
        staffId,
      },
    });

    await tx.staffService.createMany({
      data: uniqueServiceIds.map((serviceId) => ({
        staffId,
        serviceId,
      })),
    });
  });

  return {
    staffId,
    serviceIds: uniqueServiceIds,
  };
};

const assignStaffPackages = async (
  staffId: string,
  payload: IAssignStaffPackagesPayload,
  requester: {
    userId: string;
    role: Role;
  },
) => {
  const staff = await prisma.staff.findUnique({
    where: {
      id: staffId,
    },

    include: {
      branches: {
        select: {
          branchId: true,
        },
      },

      services: {
        select: {
          serviceId: true,
        },
      },
    },
  });

  if (!staff) {
    throw new AppError("Staff not found", 404);
  }

  const uniquePackageIds = [...new Set(payload.packageIds)];

  if (uniquePackageIds.length !== payload.packageIds.length) {
    throw new AppError("Duplicate package IDs are not allowed", 400);
  }

  const staffBranchIds = new Set(staff.branches.map((item) => item.branchId));

  const staffServiceIds = new Set(staff.services.map((item) => item.serviceId));

  let managerBranchIds: Set<string> | null = null;

  if (requester.role === Role.BRANCH_MANAGER) {
    const managerBranches = await prisma.branchManagerBranch.findMany({
      where: {
        userId: requester.userId,
      },

      select: {
        branchId: true,
      },
    });

    managerBranchIds = new Set(managerBranches.map((item) => item.branchId));

    const hasAccessToStaff = staff.branches.some((item) =>
      managerBranchIds!.has(item.branchId),
    );

    if (!hasAccessToStaff) {
      throw new AppError(
        "You are not allowed to manage this staff member",
        403,
      );
    }
  }

  // Empty list means remove all package assignments
  if (uniquePackageIds.length === 0) {
    await prisma.staffPackage.deleteMany({
      where: {
        staffId,
      },
    });

    return {
      staffId,
      packageIds: [],
    };
  }

  const packages = await prisma.package.findMany({
    where: {
      id: {
        in: uniquePackageIds,
      },
    },

    select: {
      id: true,
      name: true,
      status: true,

      branches: {
        select: {
          branchId: true,
        },
      },

      services: {
        select: {
          serviceId: true,
        },
      },
    },
  });

  if (packages.length !== uniquePackageIds.length) {
    throw new AppError("One or more packages do not exist", 404);
  }

  for (const packageData of packages) {
    if (packageData.status !== PackageStatus.ACTIVE) {
      throw new AppError(
        `Inactive package cannot be assigned: ${packageData.name}`,
        400,
      );
    }

    const packageBranchIds = new Set(
      packageData.branches.map((item) => item.branchId),
    );

    const availableInStaffBranch = [...staffBranchIds].some((branchId) =>
      packageBranchIds.has(branchId),
    );

    if (!availableInStaffBranch) {
      throw new AppError(
        `Package "${packageData.name}" is not available in any branch assigned to this staff member`,
        400,
      );
    }

    if (requester.role === Role.BRANCH_MANAGER && managerBranchIds) {
      const availableInsideManagerScope = [...staffBranchIds].some(
        (branchId) =>
          managerBranchIds!.has(branchId) && packageBranchIds.has(branchId),
      );

      if (!availableInsideManagerScope) {
        throw new AppError(
          `You cannot assign package "${packageData.name}" outside your branch scope`,
          403,
        );
      }
    }

    // Staff must support every service inside the package
    const missingService = packageData.services.find(
      (item) => !staffServiceIds.has(item.serviceId),
    );

    if (missingService) {
      throw new AppError(
        `Staff must be eligible for all services included in package "${packageData.name}"`,
        400,
      );
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.staffPackage.deleteMany({
      where: {
        staffId,
      },
    });

    await tx.staffPackage.createMany({
      data: uniquePackageIds.map((packageId) => ({
        staffId,
        packageId,
      })),
    });
  });

  return {
    staffId,
    packageIds: uniquePackageIds,
  };
};

const getBranchStaff = async (
  branchId: string,
  language: Language = DEFAULT_LANGUAGE,
) => {
  // =====================================================
  // 1. CHECK BRANCH
  // =====================================================

  const branch = await prisma.branch.findUnique({
    where: {
      id: branchId,
    },

    select: {
      id: true,
      status: true,
    },
  });

  if (!branch) {
    throw new AppError("Branch not found", 404);
  }

  if (branch.status !== BranchStatus.ACTIVE) {
    throw new AppError("Branch is not active", 400);
  }

  // =====================================================
  // 2. FETCH ACTIVE STAFF OF BRANCH
  // =====================================================

  const staff = await prisma.staff.findMany({
    where: {
      status: StaffStatus.ACTIVE,

      branches: {
        some: {
          branchId,
        },
      },
    },

    select: {
      id: true,
      name: true,
      roleTitle: true,
      specialization: true,
      description: true,
      translations: true,
      avatarObjectKey: true,
    },

    orderBy: {
      name: "asc",
    },
  });

  // =====================================================
  // 3. FETCH VISIBLE REVIEW SUMMARY FOR BRANCH STAFF
  // =====================================================

  const staffIds = staff.map((item) => item.id);

  const reviewGroups =
    staffIds.length > 0
      ? await prisma.review.groupBy({
          by: ["staffId", "rating"],

          where: {
            staffId: {
              in: staffIds,
            },

            branchId,

            moderationStatus: ReviewModerationStatus.VISIBLE,
          },

          _count: {
            _all: true,
          },
        })
      : [];

  // =====================================================
  // 4. BUILD REVIEW SUMMARY MAP
  // =====================================================

  const reviewSummaryMap = new Map<string, ReviewSummary>();

  const reviewGroupsByStaff = new Map<string, typeof reviewGroups>();

  for (const group of reviewGroups) {
    const existingGroups = reviewGroupsByStaff.get(group.staffId) ?? [];

    existingGroups.push(group);

    reviewGroupsByStaff.set(group.staffId, existingGroups);
  }

  for (const staffId of staffIds) {
    const staffReviewGroups = reviewGroupsByStaff.get(staffId) ?? [];

    reviewSummaryMap.set(staffId, buildReviewSummary(staffReviewGroups));
  }

  // =====================================================
  // 5. LOCALIZE STAFF + GENERATE SIGNED AVATAR URLS
  // =====================================================

  const items = await Promise.all(
    staff.map(async (item) => {
      // -------------------------------------------------
      // LOCALIZE ROLE TITLE, SPECIALIZATION, DESCRIPTION
      // -------------------------------------------------

      const localizedStaff = getLocalizedContent(item.translations, language, {
        roleTitle: item.roleTitle,
        specialization: item.specialization ?? "",
        description: item.description ?? "",
      });

      // -------------------------------------------------
      // GENERATE SIGNED AVATAR URL
      // -------------------------------------------------

      const avatarUrl = item.avatarObjectKey
        ? await uploadService.getImageUrl(item.avatarObjectKey)
        : null;

      // -------------------------------------------------
      // RESPONSE ITEM
      // -------------------------------------------------

      return {
        id: item.id,

        name: item.name,

        roleTitle: localizedStaff.roleTitle,

        specialization: localizedStaff.specialization || null,

        description: localizedStaff.description || null,

        avatarObjectKey: item.avatarObjectKey,

        avatarUrl,

        reviewSummary: reviewSummaryMap.get(item.id) ?? buildReviewSummary([]),
      };
    }),
  );

  // =====================================================
  // 6. RESPONSE
  // =====================================================

  return {
    items,
  };
};
const getEligibleStaffForService = async (
  branchId: string,
  serviceId: string,
  language: Language = DEFAULT_LANGUAGE,
) => {
  // =====================================================
  // 1. CHECK BRANCH
  // =====================================================

  const branch = await prisma.branch.findUnique({
    where: {
      id: branchId,
    },

    select: {
      id: true,
      status: true,
    },
  });

  if (!branch) {
    throw new AppError("Branch not found", 404);
  }

  if (branch.status !== BranchStatus.ACTIVE) {
    throw new AppError("Branch is not active", 400);
  }

  // =====================================================
  // 2. CHECK SERVICE
  // =====================================================

  const service = await prisma.service.findUnique({
    where: {
      id: serviceId,
    },

    select: {
      id: true,
      status: true,

      branches: {
        where: {
          branchId,
        },

        select: {
          branchId: true,
        },
      },
    },
  });

  if (!service) {
    throw new AppError("Service not found", 404);
  }

  if (service.status !== ServiceStatus.ACTIVE) {
    throw new AppError("Service is not active", 400);
  }

  // Service must actually belong to selected branch.
  if (service.branches.length === 0) {
    throw new AppError("Service is not available in this branch", 400);
  }

  // =====================================================
  // 3. FETCH ELIGIBLE STAFF
  //
  // Staff must satisfy:
  // 1. ACTIVE
  // 2. Assigned to selected branch
  // 3. Assigned to selected service
  // =====================================================

  const staff = await prisma.staff.findMany({
    where: {
      status: StaffStatus.ACTIVE,

      branches: {
        some: {
          branchId,
        },
      },

      services: {
        some: {
          serviceId,
        },
      },
    },

    select: {
      id: true,
      name: true,
      roleTitle: true,
      specialization: true,

      // Multilingual support
      translations: true,

      avatarObjectKey: true,
    },

    orderBy: {
      name: "asc",
    },
  });

  // =====================================================
  // 4. LOCALIZE STAFF + GENERATE SIGNED AVATAR URLS
  // =====================================================

  const items = await Promise.all(
    staff.map(async (item) => {
      // Resolve requested language.
      // Missing translations fall back to base fields.

      const localizedStaff = getLocalizedContent(item.translations, language, {
        roleTitle: item.roleTitle,
        specialization: item.specialization ?? "",
      });

      // Generate signed avatar URL.
      const avatarUrl = item.avatarObjectKey
        ? await uploadService.getImageUrl(item.avatarObjectKey)
        : null;

      return {
        id: item.id,

        name: item.name,

        roleTitle: localizedStaff.roleTitle,

        specialization: localizedStaff.specialization || null,

        avatarObjectKey: item.avatarObjectKey,

        avatarUrl,
      };
    }),
  );

  // =====================================================
  // 5. RESPONSE
  // =====================================================

  return {
    items,
  };
};

const getEligibleStaffForPackage = async (
  branchId: string,
  packageId: string,
  language: Language = DEFAULT_LANGUAGE,
) => {
  // =====================================================
  // 1. CHECK BRANCH
  // =====================================================

  const branch = await prisma.branch.findUnique({
    where: {
      id: branchId,
    },

    select: {
      id: true,
      status: true,
    },
  });

  if (!branch) {
    throw new AppError("Branch not found", 404);
  }

  if (branch.status !== BranchStatus.ACTIVE) {
    throw new AppError("Branch is not active", 400);
  }

  // =====================================================
  // 2. CHECK PACKAGE
  // =====================================================

  const packageData = await prisma.package.findUnique({
    where: {
      id: packageId,
    },

    select: {
      id: true,
      name: true,
      status: true,
      listingStatus: true,

      branches: {
        where: {
          branchId,
        },

        select: {
          branchId: true,
        },
      },

      services: {
        select: {
          serviceId: true,
        },
      },
    },
  });

  if (!packageData) {
    throw new AppError("Package not found", 404);
  }

  if (packageData.status !== PackageStatus.ACTIVE) {
    throw new AppError("Package is not active", 400);
  }

  if (packageData.listingStatus !== ListingStatus.LISTED) {
    throw new AppError("Package is not listed", 400);
  }

  if (packageData.branches.length === 0) {
    throw new AppError("Package is not available in this branch", 400);
  }

  // =====================================================
  // 3. REQUIRED SERVICES
  // =====================================================

  const requiredServiceIds = packageData.services.map((item) => item.serviceId);

  // =====================================================
  // 4. FETCH PACKAGE-ASSIGNED STAFF
  //
  // Staff must:
  // 1. Be ACTIVE
  // 2. Be assigned to selected branch
  // 3. Be assigned to selected package
  // =====================================================

  const staffList = await prisma.staff.findMany({
    where: {
      status: StaffStatus.ACTIVE,

      branches: {
        some: {
          branchId,
        },
      },

      packages: {
        some: {
          packageId,
        },
      },
    },

    include: {
      services: {
        select: {
          serviceId: true,
        },
      },
    },

    orderBy: {
      name: "asc",
    },
  });

  // =====================================================
  // 5. STAFF MUST SUPPORT ALL PACKAGE SERVICES
  // =====================================================

  const eligibleStaff = staffList.filter((staff) => {
    const staffServiceIds = new Set(
      staff.services.map((item) => item.serviceId),
    );

    return requiredServiceIds.every((serviceId) =>
      staffServiceIds.has(serviceId),
    );
  });

  // =====================================================
  // 6. LOCALIZE STAFF + GENERATE SIGNED AVATAR URLS
  // =====================================================

  const items = await Promise.all(
    eligibleStaff.map(async (staff) => {
      // Resolve requested language.
      // Missing translations fall back to base fields.

      const localizedStaff = getLocalizedContent(staff.translations, language, {
        roleTitle: staff.roleTitle,
        specialization: staff.specialization ?? "",
      });

      // Generate signed R2 avatar URL.
      const avatarUrl = staff.avatarObjectKey
        ? await uploadService.getImageUrl(staff.avatarObjectKey)
        : null;

      return {
        id: staff.id,

        name: staff.name,

        roleTitle: localizedStaff.roleTitle,

        specialization: localizedStaff.specialization || null,

        avatarObjectKey: staff.avatarObjectKey,

        avatarUrl,
      };
    }),
  );

  // =====================================================
  // 7. RESPONSE
  // =====================================================

  return {
    items,
  };
};

const timeToMinutes = (time: string) => {
  const [hour, minute] = time.split(":").map(Number);

  return hour * 60 + minute;
};

const updateStaffSchedule = async (
  staffId: string,
  payload: IUpdateStaffSchedulePayload,
  requester: {
    userId: string;
    role: Role;
  },
) => {
  // =====================================================
  // 1. FIND STAFF
  // =====================================================

  const staff = await prisma.staff.findUnique({
    where: {
      id: staffId,
    },

    include: {
      branches: {
        select: {
          branchId: true,
        },
      },
    },
  });

  if (!staff) {
    throw new AppError("Staff not found", 404);
  }

  const staffBranchIds = new Set(staff.branches.map((item) => item.branchId));

  // =====================================================
  // 2. BRANCH MANAGER SCOPE CHECK
  // =====================================================

  let managerBranchIds: Set<string> | null = null;

  if (requester.role === Role.BRANCH_MANAGER) {
    const managerBranches = await prisma.branchManagerBranch.findMany({
      where: {
        userId: requester.userId,
      },

      select: {
        branchId: true,
      },
    });

    managerBranchIds = new Set(managerBranches.map((item) => item.branchId));

    const hasAccessToStaff = staff.branches.some((item) =>
      managerBranchIds!.has(item.branchId),
    );

    if (!hasAccessToStaff) {
      throw new AppError(
        "You are not allowed to manage this staff member",
        403,
      );
    }
  }

  // =====================================================
  // 3. PREVENT DUPLICATE BRANCH + DAY ENTRIES
  // =====================================================

  const scheduleKeys = new Set<string>();

  for (const item of payload.schedule) {
    const key = `${item.branchId}:${item.day}`;

    if (scheduleKeys.has(key)) {
      throw new AppError(
        "Duplicate schedule entry for the same branch and day is not allowed",
        400,
      );
    }

    scheduleKeys.add(key);
  }

  // =====================================================
  // 4. VALIDATE REQUESTED BRANCHES
  // =====================================================

  const scheduleBranchIds = [
    ...new Set(payload.schedule.map((item) => item.branchId)),
  ];

  const branches = await prisma.branch.findMany({
    where: {
      id: {
        in: scheduleBranchIds,
      },
    },

    select: {
      id: true,
      name: true,
      status: true,

      businessHours: {
        select: {
          day: true,
          isClosed: true,
          openTime: true,
          closeTime: true,
        },
      },
    },
  });

  if (branches.length !== scheduleBranchIds.length) {
    throw new AppError("One or more branches do not exist", 404);
  }

  const branchMap = new Map(branches.map((branch) => [branch.id, branch]));

  // =====================================================
  // 5. VALIDATE EACH SCHEDULE ENTRY
  // =====================================================

  for (const item of payload.schedule) {
    // Staff must belong to requested branch.

    if (!staffBranchIds.has(item.branchId)) {
      throw new AppError(
        "Staff cannot be scheduled in an unassigned branch",
        400,
      );
    }

    // Branch Manager scope.

    if (
      requester.role === Role.BRANCH_MANAGER &&
      managerBranchIds &&
      !managerBranchIds.has(item.branchId)
    ) {
      throw new AppError(
        "You cannot manage staff schedule outside your branch scope",
        403,
      );
    }

    const branch = branchMap.get(item.branchId)!;

    // Branch must be active.

    if (branch.status !== BranchStatus.ACTIVE) {
      throw new AppError(
        `Cannot schedule staff in inactive branch "${branch.name}"`,
        400,
      );
    }

    // Validate time range.

    const startMinutes = timeToMinutes(item.startTime);

    const endMinutes = timeToMinutes(item.endTime);

    if (startMinutes >= endMinutes) {
      throw new AppError(
        "Schedule startTime must be earlier than endTime",
        400,
      );
    }

    // Find business hours for requested day.

    const businessHour = branch.businessHours.find(
      (hour) => hour.day === item.day,
    );

    if (!businessHour) {
      throw new AppError(
        `Business hours are not configured for ${item.day} at branch "${branch.name}"`,
        400,
      );
    }

    if (businessHour.isClosed) {
      throw new AppError(
        `Branch "${branch.name}" is closed on ${item.day}`,
        400,
      );
    }

    if (!businessHour.openTime || !businessHour.closeTime) {
      throw new AppError(
        `Business hours are incomplete for ${item.day} at branch "${branch.name}"`,
        400,
      );
    }

    const branchOpenMinutes = timeToMinutes(businessHour.openTime);

    const branchCloseMinutes = timeToMinutes(businessHour.closeTime);

    if (startMinutes < branchOpenMinutes || endMinutes > branchCloseMinutes) {
      throw new AppError(
        `Staff schedule must be within branch business hours for ${item.day}`,
        400,
      );
    }
  }

  // =====================================================
  // 6. CROSS-BRANCH OVERLAP VALIDATION
  // =====================================================

  const schedulesByDay = new Map<string, typeof payload.schedule>();

  for (const item of payload.schedule) {
    const existing = schedulesByDay.get(item.day) ?? [];

    existing.push(item);

    schedulesByDay.set(item.day, existing);
  }

  for (const [day, schedules] of schedulesByDay) {
    const sortedSchedules = [...schedules].sort(
      (a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime),
    );

    for (let i = 0; i < sortedSchedules.length - 1; i++) {
      const current = sortedSchedules[i];
      const next = sortedSchedules[i + 1];

      const currentEnd = timeToMinutes(current.endTime);

      const nextStart = timeToMinutes(next.startTime);

      if (currentEnd > nextStart) {
        throw new AppError(`Schedule conflict detected on ${day}`, 409);
      }
    }
  }

  // =====================================================
  // 7. GET EXISTING STAFF SCHEDULE
  //
  // Needed to detect actual schedule changes.
  // =====================================================

  const existingSchedules = await prisma.staffSchedule.findMany({
    where: {
      staffId,
    },

    select: {
      branchId: true,
      day: true,
      startTime: true,
      endTime: true,
    },
  });

  // =====================================================
  // 8. COMPARE OLD AND NEW SCHEDULE
  //
  // Order-independent comparison.
  // =====================================================

  const normalizeSchedule = (
    schedules: Array<{
      branchId: string;
      day: string;
      startTime: string;
      endTime: string;
    }>,
  ) => {
    return schedules
      .map(
        (item) =>
          `${item.branchId}|${item.day}|${item.startTime}|${item.endTime}`,
      )
      .sort();
  };

  const oldSchedule = normalizeSchedule(existingSchedules);

  const newSchedule = normalizeSchedule(payload.schedule);

  const hasChanges =
    oldSchedule.length !== newSchedule.length ||
    oldSchedule.some((item, index) => item !== newSchedule[index]);

  // =====================================================
  // 9. NO CHANGES - SKIP UPDATE + NOTIFICATION
  // =====================================================

  if (!hasChanges) {
    return {
      staffId,
    };
  }

  // =====================================================
  // 10. REPLACE STAFF SCHEDULE ATOMICALLY
  // =====================================================

  await prisma.$transaction(async (tx) => {
    // Remove previous schedule.

    await tx.staffSchedule.deleteMany({
      where: {
        staffId,
      },
    });

    // Create new schedule entries.

    if (payload.schedule.length > 0) {
      await tx.staffSchedule.createMany({
        data: payload.schedule.map((item) => ({
          staffId,
          branchId: item.branchId,
          day: item.day,
          startTime: item.startTime,
          endTime: item.endTime,
        })),
      });
    }
  });

  // =====================================================
  // 11. MULTILINGUAL SCHEDULE NOTIFICATION
  //
  // Recipient: Staff.userId
  // Only after successful schedule update.
  // =====================================================

  if (staff.userId) {
    try {
      const translations = notificationTemplates.STAFF_SCHEDULE_UPDATED();

      await notificationService.createNotification({
        userId: staff.userId,

        type: "STAFF_SCHEDULE_UPDATED",

        title: translations.en!.title!,

        message: translations.en!.message!,

        translations,
      });
    } catch (error) {
      // Notification failure must not undo
      // successful schedule update.

      logUnexpectedError(error, {
        source: "src/app/module/staff/staff.service.ts:3273",
      });
    }
  }

  // =====================================================
  // 12. RESPONSE
  //
  // Preserve existing response structure.
  // =====================================================

  return {
    staffId,
  };
};

const getStaffSchedule = async (
  staffId: string,
  requester: {
    userId: string;
    role: Role;
  },
  language: Language = DEFAULT_LANGUAGE,
  filters: {
    branchId?: string;
    startDate?: string;
    endDate?: string;
  } = {},
) => {
  const { branchId, startDate, endDate } = filters;

  // =====================================================
  // 1. VALIDATE DATE RANGE
  // =====================================================

  if ((startDate && !endDate) || (!startDate && endDate)) {
    throw new AppError(
      "Both startDate and endDate are required for date range filtering",
      400,
    );
  }

  const parseDateOnly = (value: string): Date => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new AppError("Date must be in YYYY-MM-DD format", 400);
    }

    const parsed = new Date(`${value}T00:00:00.000Z`);

    if (
      Number.isNaN(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== value
    ) {
      throw new AppError("Invalid calendar date", 400);
    }

    return parsed;
  };

  let rangeStart: Date | null = null;
  let rangeEnd: Date | null = null;

  if (startDate && endDate) {
    rangeStart = parseDateOnly(startDate);
    rangeEnd = parseDateOnly(endDate);

    if (rangeStart.getTime() > rangeEnd.getTime()) {
      throw new AppError("startDate cannot be later than endDate", 400);
    }
  }

  // =====================================================
  // 2. FIND STAFF
  // =====================================================

  const staff = await prisma.staff.findUnique({
    where: {
      id: staffId,
    },

    include: {
      branches: {
        select: {
          branchId: true,
        },
      },
    },
  });

  if (!staff) {
    throw new AppError("Staff not found", 404);
  }

  // =====================================================
  // 3. STAFF ACCESS CONTROL
  // =====================================================

  if (requester.role === Role.STAFF) {
    if (staff.userId !== requester.userId) {
      throw new AppError(
        "You are not allowed to view this staff schedule",
        403,
      );
    }
  }

  // =====================================================
  // 4. BRANCH MANAGER ACCESS CONTROL
  // =====================================================

  let allowedBranchIds: string[] | undefined;

  if (requester.role === Role.BRANCH_MANAGER) {
    const managerBranches = await prisma.branchManagerBranch.findMany({
      where: {
        userId: requester.userId,
      },

      select: {
        branchId: true,
      },
    });

    const managedBranchIds = new Set(
      managerBranches.map((item) => item.branchId),
    );

    allowedBranchIds = staff.branches
      .map((item) => item.branchId)
      .filter((id) => managedBranchIds.has(id));

    if (allowedBranchIds.length === 0) {
      throw new AppError(
        "You are not allowed to view this staff schedule",
        403,
      );
    }

    if (branchId && !allowedBranchIds.includes(branchId)) {
      throw new AppError(
        "You are not allowed to view this branch schedule",
        403,
      );
    }
  }

  // =====================================================
  // 5. VALIDATE BRANCH FILTER
  // =====================================================

  if (branchId) {
    const assignedToBranch = staff.branches.some(
      (item) => item.branchId === branchId,
    );

    if (!assignedToBranch) {
      throw new AppError("Staff is not assigned to this branch", 400);
    }
  }

  // =====================================================
  // 6. BUILD BRANCH FILTER
  // =====================================================

  const scheduleWhere: Prisma.StaffScheduleWhereInput = {
    staffId,

    ...(branchId
      ? {
          branchId,
        }
      : allowedBranchIds
        ? {
            branchId: {
              in: allowedBranchIds,
            },
          }
        : {}),
  };

  // =====================================================
  // 7. FETCH WEEKLY STAFF SCHEDULE
  // =====================================================

  const schedule = await prisma.staffSchedule.findMany({
    where: scheduleWhere,

    include: {
      branch: {
        select: {
          id: true,
          name: true,
          translations: true,
        },
      },
    },

    orderBy: [
      {
        day: "asc",
      },
      {
        startTime: "asc",
      },
    ],
  });

  // =====================================================
  // 8. DATE RANGE FILTER
  // =====================================================

  // StaffSchedule stores recurring weekdays, not calendar dates.
  // Therefore, date range filtering matches weekdays occurring
  // within the requested inclusive date range.
  //
  // This assumes StaffSchedule.day uses:
  // MONDAY, TUESDAY, WEDNESDAY, THURSDAY,
  // FRIDAY, SATURDAY, SUNDAY.

  const weekdayNames = [
    "SUNDAY",
    "MONDAY",
    "TUESDAY",
    "WEDNESDAY",
    "THURSDAY",
    "FRIDAY",
    "SATURDAY",
  ];

  let allowedWeekdays: Set<string> | null = null;

  if (rangeStart && rangeEnd) {
    allowedWeekdays = new Set<string>();

    const daysInRange =
      Math.floor((rangeEnd.getTime() - rangeStart.getTime()) / 86400000) + 1;

    // Every range of seven or more consecutive days
    // contains all seven weekdays.
    const daysToInspect = Math.min(daysInRange, 7);

    for (let offset = 0; offset < daysToInspect; offset++) {
      const currentDate = new Date(rangeStart.getTime() + offset * 86400000);

      allowedWeekdays.add(weekdayNames[currentDate.getUTCDay()]);
    }
  }

  const filteredSchedule = allowedWeekdays
    ? schedule.filter((item) =>
        allowedWeekdays.has(String(item.day).toUpperCase()),
      )
    : schedule;

  // =====================================================
  // 9. LOCALIZED RESPONSE
  // =====================================================

  return {
    staffId: staff.id,

    schedule: filteredSchedule.map((item) => {
      const localizedBranch = getLocalizedContent(
        item.branch.translations,
        language,
        {
          name: item.branch.name,
        },
      );

      return {
        day: item.day,

        branch: {
          id: item.branch.id,
          name: localizedBranch.name,
        },

        branchId: item.branchId,

        startTime: item.startTime,
        endTime: item.endTime,
      };
    }),
  };
};

const getDayOfWeekFromDate = (date: string): DayOfWeek => {
  const jsDay = new Date(`${date}T00:00:00Z`).getUTCDay();

  const dayMap: Record<number, DayOfWeek> = {
    0: DayOfWeek.SUNDAY,
    1: DayOfWeek.MONDAY,
    2: DayOfWeek.TUESDAY,
    3: DayOfWeek.WEDNESDAY,
    4: DayOfWeek.THURSDAY,
    5: DayOfWeek.FRIDAY,
    6: DayOfWeek.SATURDAY,
  };

  return dayMap[jsDay];
};

const createStaffUnavailability = async (
  staffId: string,
  payload: ICreateStaffUnavailabilityPayload,
  requester: {
    userId: string;
    role: Role;
  },
) => {
  // =====================================================
  // 1. FIND STAFF
  // =====================================================

  const staff = await prisma.staff.findUnique({
    where: { id: staffId },
    include: {
      branches: {
        select: {
          branchId: true,
        },
      },
    },
  });

  if (!staff) {
    throw new AppError("Staff not found", 404);
  }

  // =====================================================
  // 2. BRANCH MANAGER SCOPE
  // =====================================================

  if (requester.role === Role.BRANCH_MANAGER) {
    const managerBranches = await prisma.branchManagerBranch.findMany({
      where: {
        userId: requester.userId,
      },
      select: {
        branchId: true,
      },
    });

    const allowedBranchIds = new Set(
      managerBranches.map((item) => item.branchId),
    );

    const hasAccess = staff.branches.some((item) =>
      allowedBranchIds.has(item.branchId),
    );

    if (!hasAccess) {
      throw new AppError(
        "You are not allowed to manage this staff member",
        403,
      );
    }
  }

  // =====================================================
  // 3. VALIDATE DATE RANGE
  // =====================================================

  const isFullDay = payload.fullDay === true;

  const startDateString = payload.startDate ?? payload.date;
  const endDateString = payload.endDate ?? startDateString;

  if (!startDateString || !endDateString) {
    throw new AppError("Date is required", 400);
  }

  const parseDate = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new AppError("Invalid date format", 400);
    }

    const date = new Date(`${value}T00:00:00.000Z`);

    if (
      Number.isNaN(date.getTime()) ||
      date.toISOString().slice(0, 10) !== value
    ) {
      throw new AppError("Invalid date", 400);
    }

    return date;
  };

  const startDate = parseDate(startDateString);
  const endDate = parseDate(endDateString);

  if (startDate > endDate) {
    throw new AppError("startDate must not be after endDate", 400);
  }

  const totalDays =
    Math.round((endDate.getTime() - startDate.getTime()) / 86400000) + 1;

  if (totalDays > 31) {
    throw new AppError("Leave duration cannot exceed 31 days", 400);
  }

  if (totalDays > 1 && !["LEAVE", "TIME_OFF"].includes(payload.type)) {
    throw new AppError(
      "Multiple-day unavailability is only supported for LEAVE and TIME_OFF",
      400,
    );
  }

  // =====================================================
  // 4. VALIDATE TIME
  // =====================================================

  if (!isFullDay && (!payload.startTime || !payload.endTime)) {
    throw new AppError("startTime and endTime are required", 400);
  }

  if (isFullDay && !["LEAVE", "TIME_OFF"].includes(payload.type)) {
    throw new AppError(
      "Full-day unavailability is only supported for LEAVE and TIME_OFF",
      400,
    );
  }

  const requestedStartMinutes = isFullDay
    ? 0
    : timeToMinutes(payload.startTime!);

  const requestedEndMinutes = isFullDay
    ? 1439
    : timeToMinutes(payload.endTime!);

  if (requestedStartMinutes >= requestedEndMinutes) {
    throw new AppError("startTime must be earlier than endTime", 400);
  }

  // =====================================================
  // 5. BUILD DATES
  // =====================================================

  const dates: Date[] = [];

  for (let i = 0; i < totalDays; i++) {
    const date = new Date(startDate.getTime() + i * 86400000);

    dates.push(date);
  }

  // =====================================================
  // 6. LOAD STAFF SCHEDULES
  // =====================================================

  const schedules = await prisma.staffSchedule.findMany({
    where: {
      staffId,
    },
    select: {
      day: true,
      branchId: true,
      startTime: true,
      endTime: true,
    },
  });

  // =====================================================
  // 7. PREPARE DAILY RECORDS
  // =====================================================

  const records: {
    staffId: string;
    type: StaffUnavailabilityType;
    date: Date;
    startTime: string;
    endTime: string;
    reason: string | null;
  }[] = [];

  for (const date of dates) {
    const dateString = date.toISOString().slice(0, 10);
    const day = getDayOfWeekFromDate(dateString);

    const dailySchedules = schedules.filter((schedule) => schedule.day === day);

    // Full-day leave on non-working days does not need a record.
    if (dailySchedules.length === 0 && isFullDay) {
      continue;
    }

    if (dailySchedules.length === 0) {
      throw new AppError(
        `Staff is not scheduled to work on ${dateString}`,
        400,
      );
    }

    let startTime: string;
    let endTime: string;

    if (isFullDay) {
      const starts = dailySchedules.map((schedule) =>
        timeToMinutes(schedule.startTime),
      );

      const ends = dailySchedules.map((schedule) =>
        timeToMinutes(schedule.endTime),
      );

      const earliestStart = Math.min(...starts);
      const latestEnd = Math.max(...ends);

      const toTime = (minutes: number) => {
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;

        return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
      };

      startTime = toTime(earliestStart);
      endTime = toTime(latestEnd);
    } else {
      const fitsWorkingSchedule = dailySchedules.some((schedule) => {
        const workStart = timeToMinutes(schedule.startTime);

        const workEnd = timeToMinutes(schedule.endTime);

        return (
          requestedStartMinutes >= workStart && requestedEndMinutes <= workEnd
        );
      });

      if (!fitsWorkingSchedule) {
        throw new AppError(
          `Unavailability must be within staff working hours on ${dateString}`,
          400,
        );
      }

      startTime = payload.startTime!;
      endTime = payload.endTime!;
    }

    records.push({
      staffId,
      type: payload.type,
      date,
      startTime,
      endTime,
      reason: payload.reason?.trim() || null,
    });
  }

  if (records.length === 0) {
    throw new AppError(
      "No scheduled working days found in the selected date range",
      400,
    );
  }

  // =====================================================
  // 8. CHECK EXISTING UNAVAILABILITY
  // =====================================================

  const existing = await prisma.staffUnavailability.findMany({
    where: {
      staffId,
      date: {
        in: records.map((record) => record.date),
      },
    },
    select: {
      date: true,
      startTime: true,
      endTime: true,
    },
  });

  for (const record of records) {
    const recordStart = timeToMinutes(record.startTime);
    const recordEnd = timeToMinutes(record.endTime);

    const hasOverlap = existing.some((item) => {
      if (item.date.getTime() !== record.date.getTime()) {
        return false;
      }

      return (
        recordStart < timeToMinutes(item.endTime) &&
        recordEnd > timeToMinutes(item.startTime)
      );
    });

    if (hasOverlap) {
      throw new AppError(
        `Unavailability conflicts with an existing blocked period on ${record.date.toISOString().slice(0, 10)}`,
        409,
      );
    }
  }

  // =====================================================
  // 9. CHECK EXISTING APPOINTMENT CONFLICTS
  // =====================================================

  // =====================================================
  // 9. CHECK EXISTING APPOINTMENT CONFLICTS
  // =====================================================

  const now = new Date();

  const appointments = await prisma.appointment.findMany({
    where: {
      staffId,
      date: {
        in: records.map((record) => record.date),
      },
      OR: [
        {
          appointmentStatus: {
            in: ["RESERVED", "CONFIRMED"],
          },
        },
        {
          appointmentStatus: "PENDING_PAYMENT",
          OR: [{ holdExpiresAt: null }, { holdExpiresAt: { gt: now } }],
        },
      ],
    },
    select: {
      id: true,
      date: true,
      startTime: true,
      endTime: true,
      appointmentStatus: true,
    },
  });

  for (const record of records) {
    const recordDate = record.date.toISOString().slice(0, 10);

    const recordStart = timeToMinutes(record.startTime);
    const recordEnd = timeToMinutes(record.endTime);

    const conflictingAppointment = appointments.find((appointment) => {
      const appointmentDate = appointment.date.toISOString().slice(0, 10);

      if (appointmentDate !== recordDate) {
        return false;
      }

      const appointmentStart = timeToMinutes(appointment.startTime);

      const appointmentEnd = timeToMinutes(appointment.endTime);

      return recordStart < appointmentEnd && recordEnd > appointmentStart;
    });

    if (conflictingAppointment) {
      throw new AppError(
        `Staff has an existing ${conflictingAppointment.appointmentStatus} appointment on ${recordDate}`,
        409,
      );
    }
  }
  // =====================================================
  // 10. CREATE RECORDS
  // =====================================================

  const results = await prisma.$transaction(
    records.map((record) =>
      prisma.staffUnavailability.create({
        data: record,
      }),
    ),
  );

  // =====================================================
  // 11. RESPONSE
  // =====================================================

  return {
    totalDays: results.length,
    items: results.map((result) => ({
      id: result.id,
      type: result.type,
      date: result.date.toISOString().slice(0, 10),
      startTime: result.startTime,
      endTime: result.endTime,
      reason: result.reason,
    })),
  };
};

const getStaffUnavailability = async (
  staffId: string,
  query: {
    from?: string;
    to?: string;
  },
  requester: {
    userId: string;
    role: Role;
  },
) => {
  const staff = await prisma.staff.findUnique({
    where: {
      id: staffId,
    },

    include: {
      branches: {
        select: {
          branchId: true,
        },
      },
    },
  });

  if (!staff) {
    throw new AppError("Staff not found", 404);
  }

  // STAFF can only view own unavailability
  if (requester.role === Role.STAFF) {
    if (staff.userId !== requester.userId) {
      throw new AppError(
        "You are not allowed to view this staff unavailability",
        403,
      );
    }
  }

  // BRANCH_MANAGER scope check
  if (requester.role === Role.BRANCH_MANAGER) {
    const managerBranches = await prisma.branchManagerBranch.findMany({
      where: {
        userId: requester.userId,
      },

      select: {
        branchId: true,
      },
    });

    const allowedBranchIds = new Set(
      managerBranches.map((item) => item.branchId),
    );

    const hasAccess = staff.branches.some((item) =>
      allowedBranchIds.has(item.branchId),
    );

    if (!hasAccess) {
      throw new AppError(
        "You are not allowed to view this staff unavailability",
        403,
      );
    }
  }

  let fromDate: Date | undefined;
  let toDate: Date | undefined;

  if (query.from) {
    fromDate = new Date(`${query.from}T00:00:00.000Z`);
  }

  if (query.to) {
    toDate = new Date(`${query.to}T23:59:59.999Z`);
  }

  if (fromDate && toDate && fromDate > toDate) {
    throw new AppError("from date must not be later than to date", 400);
  }

  const items = await prisma.staffUnavailability.findMany({
    where: {
      staffId,

      ...(fromDate || toDate
        ? {
            date: {
              ...(fromDate && {
                gte: fromDate,
              }),

              ...(toDate && {
                lte: toDate,
              }),
            },
          }
        : {}),
    },

    orderBy: [
      {
        date: "asc",
      },
      {
        startTime: "asc",
      },
    ],
  });

  return {
    items: items.map((item) => ({
      id: item.id,
      type: item.type,

      date: item.date.toISOString().slice(0, 10),

      startTime: item.startTime,
      endTime: item.endTime,
      reason: item.reason,

      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    })),
  };
};

const updateStaffUnavailability = async (
  staffId: string,
  unavailabilityId: string,
  payload: IUpdateStaffUnavailabilityPayload,
  requester: {
    userId: string;
    role: Role;
  },
) => {
  // =====================================================
  // 1. FIND STAFF
  // =====================================================

  const staff = await prisma.staff.findUnique({
    where: { id: staffId },
    include: {
      branches: {
        select: {
          branchId: true,
        },
      },
    },
  });

  if (!staff) {
    throw new AppError("Staff not found", 404);
  }

  // =====================================================
  // 2. BRANCH MANAGER AUTHORIZATION
  // =====================================================

  if (requester.role === Role.BRANCH_MANAGER) {
    const managerBranches = await prisma.branchManagerBranch.findMany({
      where: {
        userId: requester.userId,
      },
      select: {
        branchId: true,
      },
    });

    const allowedBranchIds = new Set(
      managerBranches.map((item) => item.branchId),
    );

    // Staff-wide unavailability affects every assigned branch.
    // Require access to all staff branches.
    const hasAccess =
      staff.branches.length > 0 &&
      staff.branches.every((item) => allowedBranchIds.has(item.branchId));

    if (!hasAccess) {
      throw new AppError(
        "You are not allowed to manage staff-wide unavailability",
        403,
      );
    }
  }

  // =====================================================
  // 3. FIND EXISTING UNAVAILABILITY
  // =====================================================

  const existingUnavailability = await prisma.staffUnavailability.findFirst({
    where: {
      id: unavailabilityId,
      staffId,
    },
  });

  if (!existingUnavailability) {
    throw new AppError("Staff unavailability not found", 404);
  }

  // =====================================================
  // 4. RESOLVE FINAL VALUES
  // =====================================================

  const finalType = payload.type ?? existingUnavailability.type;

  const finalDateString =
    payload.date ?? existingUnavailability.date.toISOString().slice(0, 10);

  const finalStartTime = payload.startTime ?? existingUnavailability.startTime;

  const finalEndTime = payload.endTime ?? existingUnavailability.endTime;

  const finalReason =
    payload.reason !== undefined
      ? payload.reason.trim() || null
      : existingUnavailability.reason;

  // =====================================================
  // 5. VALIDATE DATE AND TIME
  // =====================================================

  if (!/^\d{4}-\d{2}-\d{2}$/.test(finalDateString)) {
    throw new AppError("date must be in YYYY-MM-DD format", 400);
  }

  const finalDate = new Date(`${finalDateString}T00:00:00.000Z`);

  if (
    Number.isNaN(finalDate.getTime()) ||
    finalDate.toISOString().slice(0, 10) !== finalDateString
  ) {
    throw new AppError("Invalid date", 400);
  }

  const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;

  if (!timeRegex.test(finalStartTime) || !timeRegex.test(finalEndTime)) {
    throw new AppError("Time must be in HH:mm format", 400);
  }

  const startMinutes = timeToMinutes(finalStartTime);
  const endMinutes = timeToMinutes(finalEndTime);

  if (startMinutes >= endMinutes) {
    throw new AppError("startTime must be earlier than endTime", 400);
  }

  // =====================================================
  // 6. VALIDATE STAFF WORKING SCHEDULE
  // =====================================================

  const day = getDayOfWeekFromDate(finalDateString);

  const schedules = await prisma.staffSchedule.findMany({
    where: {
      staffId,
      day,
    },
    select: {
      branchId: true,
      startTime: true,
      endTime: true,
    },
  });

  if (schedules.length === 0) {
    throw new AppError("Staff is not scheduled to work on this date", 400);
  }

  const fitsWorkingSchedule = schedules.some((schedule) => {
    const workStart = timeToMinutes(schedule.startTime);

    const workEnd = timeToMinutes(schedule.endTime);

    return startMinutes >= workStart && endMinutes <= workEnd;
  });

  // Full-day LEAVE/TIME_OFF may span multiple working periods.
  const isLeaveType = finalType === "LEAVE" || finalType === "TIME_OFF";

  const coversAllSchedules =
    isLeaveType &&
    schedules.every((schedule) => {
      const workStart = timeToMinutes(schedule.startTime);

      const workEnd = timeToMinutes(schedule.endTime);

      return startMinutes <= workStart && endMinutes >= workEnd;
    });

  if (!fitsWorkingSchedule && !coversAllSchedules) {
    throw new AppError(
      "Unavailability must fit within a working period or cover all working periods for full-day leave",
      400,
    );
  }

  // =====================================================
  // 7. CHECK OTHER UNAVAILABILITY RECORDS
  // =====================================================

  const otherUnavailability = await prisma.staffUnavailability.findMany({
    where: {
      staffId,
      date: finalDate,
      id: {
        not: unavailabilityId,
      },
    },
    select: {
      startTime: true,
      endTime: true,
    },
  });

  const hasOverlap = otherUnavailability.some((item) => {
    const existingStart = timeToMinutes(item.startTime);

    const existingEnd = timeToMinutes(item.endTime);

    return startMinutes < existingEnd && endMinutes > existingStart;
  });

  if (hasOverlap) {
    throw new AppError(
      "Unavailability conflicts with an existing blocked period",
      409,
    );
  }

  // =====================================================
  // 8. CHECK EXISTING APPOINTMENT CONFLICTS
  // =====================================================

  const now = new Date();

  const appointments = await prisma.appointment.findMany({
    where: {
      staffId,
      date: finalDate,
      OR: [
        {
          appointmentStatus: {
            in: ["RESERVED", "CONFIRMED"],
          },
        },
        {
          appointmentStatus: "PENDING_PAYMENT",
          OR: [{ holdExpiresAt: null }, { holdExpiresAt: { gt: now } }],
        },
      ],
    },
    select: {
      id: true,
      startTime: true,
      endTime: true,
      appointmentStatus: true,
    },
  });

  const conflictingAppointment = appointments.find((appointment) => {
    const appointmentStart = timeToMinutes(appointment.startTime);

    const appointmentEnd = timeToMinutes(appointment.endTime);

    return startMinutes < appointmentEnd && endMinutes > appointmentStart;
  });

  if (conflictingAppointment) {
    throw new AppError(
      `Staff has an existing ${conflictingAppointment.appointmentStatus} appointment on ${finalDateString}`,
      409,
    );
  }

  // =====================================================
  // 9. UPDATE RECORD
  // =====================================================

  const updated = await prisma.staffUnavailability.update({
    where: {
      id: unavailabilityId,
    },
    data: {
      type: finalType,
      date: finalDate,
      startTime: finalStartTime,
      endTime: finalEndTime,
      reason: finalReason,
    },
  });

  // =====================================================
  // 10. RESPONSE — PRESERVE EXISTING FORMAT
  // =====================================================

  return {
    id: updated.id,
    type: updated.type,
    date: updated.date.toISOString().slice(0, 10),
    startTime: updated.startTime,
    endTime: updated.endTime,
    reason: updated.reason,
  };
};

const deleteStaffUnavailability = async (
  staffId: string,
  unavailabilityId: string,
  requester: {
    userId: string;
    role: Role;
  },
) => {
  const staff = await prisma.staff.findUnique({
    where: {
      id: staffId,
    },

    include: {
      branches: {
        select: {
          branchId: true,
        },
      },
    },
  });

  if (!staff) {
    throw new AppError("Staff not found", 404);
  }

  if (requester.role === Role.BRANCH_MANAGER) {
    const managerBranches = await prisma.branchManagerBranch.findMany({
      where: {
        userId: requester.userId,
      },

      select: {
        branchId: true,
      },
    });

    const allowedBranchIds = new Set(
      managerBranches.map((item) => item.branchId),
    );

    const hasAccess = staff.branches.some((item) =>
      allowedBranchIds.has(item.branchId),
    );

    if (!hasAccess) {
      throw new AppError(
        "You are not allowed to manage this staff member",
        403,
      );
    }
  }

  const existingUnavailability = await prisma.staffUnavailability.findFirst({
    where: {
      id: unavailabilityId,
      staffId,
    },
  });

  if (!existingUnavailability) {
    throw new AppError("Staff unavailability not found", 404);
  }

  await prisma.staffUnavailability.delete({
    where: {
      id: unavailabilityId,
    },
  });

  return null;
};

const getMyStaffSchedule = async (
  userId: string,
  language: Language = DEFAULT_LANGUAGE,
) => {
  // =====================================================
  // 1. FIND LOGGED-IN STAFF
  // =====================================================

  const staff = await prisma.staff.findUnique({
    where: {
      userId,
    },

    select: {
      id: true,
    },
  });

  if (!staff) {
    throw new AppError("Staff profile not found", 404);
  }

  // =====================================================
  // 2. RETURN LOCALIZED STAFF SCHEDULE
  // =====================================================

  return getStaffSchedule(
    staff.id,
    {
      userId,
      role: Role.STAFF,
    },
    language,
  );
};

const getMyAppointments = async (
  userId: string,
  query: IMyStaffAppointmentsQuery,
  language: Language = DEFAULT_LANGUAGE,
) => {
  // =====================================================
  // 1. RESOLVE LOGGED-IN STAFF
  // =====================================================

  const staff = await prisma.staff.findUnique({
    where: {
      userId,
    },
    select: {
      id: true,
      status: true,
    },
  });

  if (!staff) {
    throw new AppError("Staff not found", 404);
  }

  if (staff.status !== StaffStatus.ACTIVE) {
    throw new AppError("Staff is inactive", 403);
  }

  // =====================================================
  // 2. PAGINATION
  // =====================================================

  const page = Number(query.page ?? 1);
  const limit = Number(query.limit ?? 20);

  if (!Number.isInteger(page) || page < 1) {
    throw new AppError("page must be a positive integer", 400);
  }

  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new AppError("limit must be an integer between 1 and 100", 400);
  }

  const skip = (page - 1) * limit;

  // =====================================================
  // 3. VALIDATE APPOINTMENT TYPE
  // =====================================================

  const appointmentType = query.type;

  if (
    appointmentType !== undefined &&
    appointmentType !== "UPCOMING" &&
    appointmentType !== "HISTORY"
  ) {
    throw new AppError("type must be UPCOMING or HISTORY", 400);
  }

  // =====================================================
  // 4. BRAND TIMEZONE — LEGACY FALLBACK
  // =====================================================

  const brandSettings = await getBrandInternationalSettings();

  const fallbackTimezone = brandSettings.timezone;
  const now = new Date();

  // =====================================================
  // 5. APPOINTMENT STATUS GROUPS
  // =====================================================

  const activeStatuses: AppointmentStatus[] = [
    AppointmentStatus.PENDING_PAYMENT,
    AppointmentStatus.RESERVED,
    AppointmentStatus.CONFIRMED,
  ];

  const historyStatuses: AppointmentStatus[] = [
    AppointmentStatus.COMPLETED,
    AppointmentStatus.CANCELLED,
    AppointmentStatus.NO_SHOW,
    AppointmentStatus.EXPIRED,
  ];

  // =====================================================
  // 6. BASE FILTERS
  // =====================================================

  const filters: Prisma.AppointmentWhereInput[] = [
    {
      staffId: staff.id,
    },
  ];

  // =====================================================
  // 6.1 PRESERVE DATE FILTER
  // =====================================================

  if (query.date) {
    const date = new Date(`${query.date}T00:00:00.000Z`);

    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(query.date) ||
      Number.isNaN(date.getTime()) ||
      date.toISOString().slice(0, 10) !== query.date
    ) {
      throw new AppError("date must be a valid YYYY-MM-DD date", 400);
    }

    filters.push({
      date,
    });
  }

  // =====================================================
  // 6.2 PRESERVE STATUS FILTER
  // =====================================================

  if (query.status) {
    if (
      !Object.values(AppointmentStatus).includes(
        query.status as AppointmentStatus,
      )
    ) {
      throw new AppError("Invalid appointment status", 400);
    }

    filters.push({
      appointmentStatus: query.status as AppointmentStatus,
    });
  }

  // =====================================================
  // 7. TIMEZONE-AWARE UPCOMING / HISTORY
  // =====================================================

  if (appointmentType === "UPCOMING" || appointmentType === "HISTORY") {
    // Read only distinct saved timezones.
    // This query is scoped to the logged-in staff.

    const timezoneRows = await prisma.appointment.findMany({
      where: {
        staffId: staff.id,
      },
      select: {
        timezone: true,
      },
      distinct: ["timezone"],
    });

    // -------------------------------------------------
    // GET CURRENT LOCAL DATE/TIME IN A TIMEZONE
    // -------------------------------------------------

    const getCurrentLocalTime = (timezone: string) => {
      const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).formatToParts(now);

      const getPart = (type: string): string =>
        parts.find((part) => part.type === type)?.value ?? "";

      const localDate = [
        getPart("year"),
        getPart("month"),
        getPart("day"),
      ].join("-");

      const localTime = `${getPart("hour")}:${getPart("minute")}`;

      // Date-only key, normalized to UTC midnight.

      const todayDate = new Date(`${localDate}T00:00:00.000Z`);

      return {
        todayDate,
        localTime,
      };
    };

    // -------------------------------------------------
    // BUILD TIMEZONE-SPECIFIC CONDITIONS
    // -------------------------------------------------

    const timezoneFilters: Prisma.AppointmentWhereInput[] = [];

    for (const row of timezoneRows) {
      const savedTimezone = row.timezone;

      // Keep the persisted timezone when present.
      // Legacy null records use brand fallback.

      const effectiveTimezone = savedTimezone ?? fallbackTimezone;

      const { todayDate, localTime } = getCurrentLocalTime(effectiveTimezone);

      const timezoneCondition: Prisma.AppointmentWhereInput = {
        timezone: savedTimezone,
      };

      const upcomingDateCondition: Prisma.AppointmentWhereInput = {
        OR: [
          {
            date: {
              gt: todayDate,
            },
          },
          {
            date: todayDate,
            endTime: {
              gt: localTime,
            },
          },
        ],
      };

      const historyDateCondition: Prisma.AppointmentWhereInput = {
        OR: [
          {
            date: {
              lt: todayDate,
            },
          },
          {
            date: todayDate,
            endTime: {
              lte: localTime,
            },
          },
        ],
      };

      if (appointmentType === "UPCOMING") {
        timezoneFilters.push({
          AND: [
            timezoneCondition,
            {
              appointmentStatus: {
                in: activeStatuses,
              },
            },
            upcomingDateCondition,
          ],
        });
      } else {
        timezoneFilters.push({
          AND: [
            timezoneCondition,
            {
              OR: [
                {
                  appointmentStatus: {
                    in: historyStatuses,
                  },
                },
                {
                  AND: [
                    {
                      appointmentStatus: {
                        in: activeStatuses,
                      },
                    },
                    historyDateCondition,
                  ],
                },
              ],
            },
          ],
        });
      }
    }

    // Empty timezone list must produce no results,
    // not accidentally remove the type filter.

    if (timezoneFilters.length === 0) {
      filters.push({
        id: {
          in: [],
        },
      });
    } else {
      filters.push({
        OR: timezoneFilters,
      });
    }
  }

  // =====================================================
  // 8. FINAL DATABASE FILTER
  // =====================================================

  const where: Prisma.AppointmentWhereInput = {
    AND: filters,
  };

  // =====================================================
  // 9. FETCH APPOINTMENTS
  // =====================================================

  const [appointments, total] = await prisma.$transaction([
    prisma.appointment.findMany({
      where,
      skip,
      take: limit,

      orderBy:
        appointmentType === "HISTORY"
          ? [{ date: "desc" }, { startTime: "desc" }]
          : [{ date: "asc" }, { startTime: "asc" }],

      select: {
        id: true,

        bookingMethod: true,
        appointmentStatus: true,
        paymentStatus: true,

        date: true,
        startTime: true,
        endTime: true,

        timezone: true,

        itemName: true,
        durationMinutes: true,

        branch: {
          select: {
            id: true,
            name: true,
            translations: true,
          },
        },

        customer: {
          select: {
            id: true,
            name: true,
            phone: true,
          },
        },

        serviceId: true,
        packageId: true,
      },
    }),

    prisma.appointment.count({
      where,
    }),
  ]);

  // =====================================================
  // 10. FETCH SERVICE/PACKAGE TRANSLATIONS
  // =====================================================

  const serviceIds = [
    ...new Set(
      appointments
        .map((item) => item.serviceId)
        .filter((id): id is string => id !== null),
    ),
  ];

  const packageIds = [
    ...new Set(
      appointments
        .map((item) => item.packageId)
        .filter((id): id is string => id !== null),
    ),
  ];

  const [services, packages] = await Promise.all([
    serviceIds.length > 0
      ? prisma.service.findMany({
          where: {
            id: {
              in: serviceIds,
            },
          },
          select: {
            id: true,
            name: true,
            translations: true,
          },
        })
      : Promise.resolve([]),

    packageIds.length > 0
      ? prisma.package.findMany({
          where: {
            id: {
              in: packageIds,
            },
          },
          select: {
            id: true,
            name: true,
            translations: true,
          },
        })
      : Promise.resolve([]),
  ]);

  // =====================================================
  // 11. BUILD LOCALIZED NAME MAPS
  // =====================================================

  const serviceNameMap = new Map<string, string>();

  for (const service of services) {
    const localizedService = getLocalizedContent(
      service.translations,
      language,
      {
        name: service.name,
      },
    );

    serviceNameMap.set(service.id, localizedService.name);
  }

  const packageNameMap = new Map<string, string>();

  for (const packageData of packages) {
    const localizedPackage = getLocalizedContent(
      packageData.translations,
      language,
      {
        name: packageData.name,
      },
    );

    packageNameMap.set(packageData.id, localizedPackage.name);
  }

  // =====================================================
  // 12. BUILD LOCALIZED RESPONSE
  // =====================================================

  const items = appointments.map((appointment) => {
    const localizedBranch = getLocalizedContent(
      appointment.branch.translations,
      language,
      {
        name: appointment.branch.name,
      },
    );

    const serviceName = appointment.serviceId
      ? (serviceNameMap.get(appointment.serviceId) ?? appointment.itemName)
      : null;

    const packageName = appointment.packageId
      ? (packageNameMap.get(appointment.packageId) ?? appointment.itemName)
      : null;

    return {
      id: appointment.id,

      bookingMethod: appointment.bookingMethod,

      appointmentStatus: appointment.appointmentStatus,

      paymentStatus: appointment.paymentStatus,

      branch: {
        id: appointment.branch.id,
        name: localizedBranch.name,
      },

      customer: {
        id: appointment.customer.id,
        name: appointment.customer.name,
        phone: appointment.customer.phone,
      },

      service: appointment.serviceId
        ? {
            id: appointment.serviceId,
            name: serviceName,
          }
        : null,

      package: appointment.packageId
        ? {
            id: appointment.packageId,
            name: packageName,
          }
        : null,

      date: appointment.date.toISOString().slice(0, 10),

      startTime: appointment.startTime,
      endTime: appointment.endTime,

      // Booking-time timezone snapshot.
      // Legacy records may return null.

      timezone: appointment.timezone,

      durationMinutes: appointment.durationMinutes,
    };
  });

  // =====================================================
  // 13. PAGINATION
  // =====================================================

  const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

  // =====================================================
  // 14. FINAL RESPONSE
  // =====================================================

  return {
    items,

    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    },
  };
};

export const staffService = {
  createStaff,
  getStaff,
  getStaffById,
  updateStaff,
  updateStaffStatus,
  assignStaffBranches,
  assignStaffServices,
  assignStaffPackages,
  getBranchStaff,
  getEligibleStaffForService,
  getEligibleStaffForPackage,
  updateStaffSchedule,
  getStaffSchedule,
  createStaffUnavailability,
  getStaffUnavailability,
  updateStaffUnavailability,
  deleteStaffUnavailability,
  getMyStaffSchedule,
  getMyAppointments,
};
