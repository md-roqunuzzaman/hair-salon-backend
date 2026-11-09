import {
  BranchStatus,
  ListingStatus,
  PackageStatus,
  PackageType,
  Prisma,
  Role,
  ServiceStatus,
  StaffStatus,
} from "../../../../generated/prisma/client.js";

import { prisma } from "../../lib/prisma.js";

import { AppError } from "../../utils/app-error.js";
import { DEFAULT_LANGUAGE, Language } from "../../utils/language.js";
import { getLocalizedContent } from "../../utils/localization.js";
import { auditLogService } from "../auditLog/auditLog.service.js";
import { uploadService } from "../upload/upload.service.js";
import { groupPurchaseOptions } from "../group-purchase/group-purchase.presentation.js";

import {
  IAssignPackageBranchesPayload,
  ICreatePackagePayload,
  IPackageTranslations,
  IUpdatePackageListingPayload,
  IUpdatePackagePayload,
  IUpdatePackageStatusPayload,
} from "./package.interface.js";

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const readPackageTranslations = (value: unknown): IPackageTranslations => {
  if (!isRecord(value)) {
    return {};
  }

  const result: IPackageTranslations = {};

  for (const language of ["en", "zh-CN", "zh-HK"] as const) {
    const locale = value[language];

    if (!isRecord(locale)) {
      continue;
    }

    result[language] = {
      ...(typeof locale.name === "string" && {
        name: locale.name,
      }),

      ...(typeof locale.description === "string" && {
        description: locale.description,
      }),

      ...(Array.isArray(locale.applicableFor) &&
        locale.applicableFor.every(
          (item): item is string => typeof item === "string",
        ) && {
          applicableFor: locale.applicableFor as string[],
        }),

      ...(Array.isArray(locale.purchaseNotice) &&
        locale.purchaseNotice.every(
          (item): item is string => typeof item === "string",
        ) && {
          purchaseNotice: locale.purchaseNotice as string[],
        }),

      ...(Array.isArray(locale.howToUse) &&
        locale.howToUse.every(
          (item): item is string => typeof item === "string",
        ) && {
          howToUse: locale.howToUse as string[],
        }),
    };
  }

  return result;
};

const buildPackageTranslations = (
  existing: unknown,
  incoming: IPackageTranslations | undefined,
  base: {
    name: string;
    description: string | null;
    applicableFor: string[];
    purchaseNotice: string[];
    howToUse: string[];
  },
): Prisma.InputJsonObject => {
  const previous = readPackageTranslations(existing);

  return {
    en: {
      name: base.name,

      ...(base.description !== null && {
        description: base.description,
      }),

      applicableFor: base.applicableFor,

      purchaseNotice: base.purchaseNotice,

      howToUse: base.howToUse,
    },

    "zh-CN": {
      ...(previous["zh-CN"] ?? {}),
      ...(incoming?.["zh-CN"] ?? {}),
    },

    "zh-HK": {
      ...(previous["zh-HK"] ?? {}),
      ...(incoming?.["zh-HK"] ?? {}),
    },
  };
};

const localizePackage = (
  packageData: {
    name: string;
    description: string | null;
    applicableFor: string[];
    purchaseNotice: string[];
    howToUse: string[];
    translations: unknown;
  },
  language: Language,
) => {
  return getLocalizedContent(packageData.translations, language, {
    name: packageData.name,

    description: packageData.description,

    applicableFor: packageData.applicableFor,

    purchaseNotice: packageData.purchaseNotice,

    howToUse: packageData.howToUse,
  });
};

const localizeName = (
  data: {
    name: string;
    translations: unknown;
  },
  language: Language,
): string => {
  return getLocalizedContent(data.translations, language, {
    name: data.name,
  }).name;
};

const createPackage = async (payload: ICreatePackagePayload) => {
  const packageName = payload.name.trim();
  const packageDescription = payload.description?.trim() || null;

  // =====================================================
  // 1. PREPARE PACKAGE DISPLAY FIELDS
  // =====================================================

  const validDays = payload.validDays ?? null;

  const applicableFor = (payload.applicableFor ?? []).map((item) =>
    item.trim(),
  );

  const purchaseNotice = (payload.purchaseNotice ?? []).map((item) =>
    item.trim(),
  );

  const howToUse = (payload.howToUse ?? []).map((item) => item.trim());

  // =====================================================
  // 2. BUILD MULTILINGUAL TRANSLATIONS
  // =====================================================

  const translations = buildPackageTranslations(null, payload.translations, {
    name: packageName,
    description: packageDescription,
    applicableFor,
    purchaseNotice,
    howToUse,
  });

  // =====================================================
  // 3. VALIDATE PACKAGE NAME
  // =====================================================

  if (packageName.length < 2 || packageName.length > 120) {
    throw new AppError(
      "Package name must contain between 2 and 120 characters",
      400,
    );
  }

  const existingPackage = await prisma.package.findFirst({
    where: {
      name: {
        equals: packageName,
        mode: "insensitive",
      },
    },
  });

  if (existingPackage) {
    throw new AppError("Package already exists", 409);
  }

  // =====================================================
  // 4. VALIDATE UNIQUE SERVICE IDS
  // =====================================================

  const uniqueServiceIds = [...new Set(payload.serviceIds)];

  if (uniqueServiceIds.length !== payload.serviceIds.length) {
    throw new AppError("Duplicate service IDs are not allowed", 400);
  }

  if (uniqueServiceIds.length === 0) {
    throw new AppError("At least one service is required", 400);
  }

  // =====================================================
  // 5. VALIDATE UNIQUE BRANCH IDS
  // =====================================================

  const uniqueBranchIds = [...new Set(payload.branchIds)];

  if (uniqueBranchIds.length !== payload.branchIds.length) {
    throw new AppError("Duplicate branch IDs are not allowed", 400);
  }

  if (uniqueBranchIds.length === 0) {
    throw new AppError("At least one branch is required", 400);
  }

  // =====================================================
  // 6. VALIDATE OPTIONAL STAFF IDS
  // =====================================================

  const requestedStaffIds = payload.staffIds ?? [];
  const uniqueStaffIds = [...new Set(requestedStaffIds)];

  if (uniqueStaffIds.length !== requestedStaffIds.length) {
    throw new AppError("Duplicate staff IDs are not allowed", 400);
  }

  // =====================================================
  // 7. VALIDATE OPTIONAL IMAGE OBJECT KEYS
  // =====================================================

  const imageObjectKeys = (payload.imageObjectKeys ?? []).map((key) =>
    key.trim(),
  );

  if (imageObjectKeys.some((key) => !key)) {
    throw new AppError("Invalid package image object key", 400);
  }

  const uniqueImageObjectKeys = [...new Set(imageObjectKeys)];

  if (uniqueImageObjectKeys.length !== imageObjectKeys.length) {
    throw new AppError("Duplicate package images are not allowed", 400);
  }

  // Verify that referenced objects exist in R2.
  // Upload authorization and key ownership must also be
  // enforced by the upload endpoint.

  await Promise.all(
    uniqueImageObjectKeys.map((objectKey) =>
      uploadService.verifyImageExists(objectKey),
    ),
  );

  // =====================================================
  // 8. CHECK SERVICES
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
    throw new AppError(
      "Inactive services cannot be included in a package",
      400,
    );
  }

  // =====================================================
  // 9. CHECK BRANCHES
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
    throw new AppError("Package cannot be assigned to an inactive branch", 400);
  }

  // =====================================================
  // 10. VALIDATE SERVICE AVAILABILITY PER BRANCH
  // =====================================================

  for (const service of services) {
    const serviceBranchIds = new Set(
      service.branches.map((item) => item.branchId),
    );

    const unavailableBranch = uniqueBranchIds.find(
      (branchId) => !serviceBranchIds.has(branchId),
    );

    if (unavailableBranch) {
      throw new AppError(
        "All package services must be available in every assigned branch",
        400,
      );
    }
  }

  // =====================================================
  // 11. VALIDATE OPTIONAL STAFF ASSIGNMENTS
  // =====================================================

  if (uniqueStaffIds.length > 0) {
    const staffMembers = await prisma.staff.findMany({
      where: {
        id: {
          in: uniqueStaffIds,
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

    if (staffMembers.length !== uniqueStaffIds.length) {
      throw new AppError("One or more staff members do not exist", 404);
    }

    const packageBranchIds = new Set(uniqueBranchIds);

    for (const staff of staffMembers) {
      // Staff must be active.

      if (staff.status !== StaffStatus.ACTIVE) {
        throw new AppError(
          `Inactive staff cannot be assigned to package: ${staff.name}`,
          400,
        );
      }

      // Staff must belong to at least one package branch.

      const hasMatchingBranch = staff.branches.some((item) =>
        packageBranchIds.has(item.branchId),
      );

      if (!hasMatchingBranch) {
        throw new AppError(
          `Staff "${staff.name}" is not assigned to any selected package branch`,
          400,
        );
      }

      // Staff must support every included service.

      const staffServiceIds = new Set(
        staff.services.map((item) => item.serviceId),
      );

      const missingServiceId = uniqueServiceIds.find(
        (serviceId) => !staffServiceIds.has(serviceId),
      );

      if (missingServiceId) {
        throw new AppError(
          `Staff "${staff.name}" must be eligible for all services included in package "${packageName}"`,
          400,
        );
      }
    }
  }

  // =====================================================
  // 12. VALIDATE PRICING AND DURATION
  // =====================================================

  if (!Number.isFinite(payload.regularPrice) || payload.regularPrice <= 0) {
    throw new AppError("Regular price must be greater than 0", 400);
  }

  if (!Number.isFinite(payload.packagePrice) || payload.packagePrice <= 0) {
    throw new AppError("Package price must be greater than 0", 400);
  }

  if (payload.packagePrice > payload.regularPrice) {
    throw new AppError(
      "Package price cannot be greater than regular price",
      400,
    );
  }

  if (
    !Number.isInteger(payload.durationMinutes) ||
    payload.durationMinutes <= 0
  ) {
    throw new AppError("Duration must be a positive integer", 400);
  }

  // =====================================================
  // 13. VALIDATE GROUP PURCHASE CONFIGURATION
  // =====================================================

  if (
    !Number.isInteger(payload.capacity) ||
    payload.capacity <= 0 ||
    !Number.isInteger(payload.purchaseLimitPerCustomer) ||
    payload.purchaseLimitPerCustomer <= 0
  ) {
    throw new AppError(
      "Group purchase capacity or purchase limit is invalid",
      400,
    );
  }

  if (payload.purchaseLimitPerCustomer > payload.capacity) {
    throw new AppError(
      "Purchase limit per customer cannot exceed package capacity",
      400,
    );
  }

  if (!payload.salesStartAt || !payload.salesEndAt) {
    throw new AppError("Sales start and end times are required", 400);
  }

  const salesStartAt = new Date(payload.salesStartAt);
  const salesEndAt = new Date(payload.salesEndAt);

  if (
    Number.isNaN(salesStartAt.getTime()) ||
    Number.isNaN(salesEndAt.getTime())
  ) {
    throw new AppError("Invalid sales date", 400);
  }

  if (salesStartAt >= salesEndAt) {
    throw new AppError(
      "Sales end time must be later than sales start time",
      400,
    );
  }

  // =====================================================
  // 14. CREATE PACKAGE + RELATIONS ATOMICALLY
  // =====================================================

  const createdPackage = await prisma.$transaction(async (tx) => {
    const packageData = await tx.package.create({
      data: {
        // Fixed package type.
        type: PackageType.GROUP_PURCHASE_PACKAGE,

        name: packageName,
        description: packageDescription,
        translations,

        // Display fields
        validDays,
        applicableFor,
        purchaseNotice,
        howToUse,

        // Pricing
        regularPrice: payload.regularPrice,
        packagePrice: payload.packagePrice,
        durationMinutes: payload.durationMinutes,

        // Listing
        listingStatus: payload.listingStatus,

        // Group purchase settings
        capacity: payload.capacity,
        soldQuantity: 0,
        reservedQuantity: 0,
        purchaseLimitPerCustomer: payload.purchaseLimitPerCustomer,
        salesStartAt,
        salesEndAt,
      },
    });

    // ================================================
    // ASSIGN SERVICES
    // ================================================

    await tx.packageService.createMany({
      data: uniqueServiceIds.map((serviceId) => ({
        packageId: packageData.id,
        serviceId,
      })),
    });

    // ================================================
    // ASSIGN BRANCHES
    // ================================================

    await tx.packageBranch.createMany({
      data: uniqueBranchIds.map((branchId) => ({
        packageId: packageData.id,
        branchId,
      })),
    });

    // ================================================
    // ASSIGN OPTIONAL STAFF
    // ================================================

    if (uniqueStaffIds.length > 0) {
      await tx.staffPackage.createMany({
        data: uniqueStaffIds.map((staffId) => ({
          staffId,
          packageId: packageData.id,
        })),
      });
    }

    // ================================================
    // SAVE OPTIONAL IMAGES
    // ================================================

    if (uniqueImageObjectKeys.length > 0) {
      await tx.packageImage.createMany({
        data: uniqueImageObjectKeys.map((objectKey, index) => ({
          packageId: packageData.id,
          objectKey,
          isPrimary: index === 0,
          sortOrder: index,
        })),
      });
    }

    // ================================================
    // FETCH SAVED IMAGES
    // ================================================

    const images = await tx.packageImage.findMany({
      where: {
        packageId: packageData.id,
      },
      orderBy: {
        sortOrder: "asc",
      },
    });

    return {
      ...packageData,
      images,
    };
  });

  // =====================================================
  // 15. FORMAT RESPONSE
  // =====================================================

  const images = createdPackage.images.map((image) => ({
    id: image.id,
    objectKey: image.objectKey,
    isPrimary: image.isPrimary,
    sortOrder: image.sortOrder,
  }));

  const capacity = createdPackage.capacity ?? 0;

  const remainingQuantity = capacity - createdPackage.soldQuantity;

  return {
    id: createdPackage.id,
    type: createdPackage.type,

    name: createdPackage.name,
    description: createdPackage.description,

    validDays: createdPackage.validDays,
    applicableFor: createdPackage.applicableFor,
    purchaseNotice: createdPackage.purchaseNotice,
    howToUse: createdPackage.howToUse,

    regularPrice: Number(createdPackage.regularPrice),
    packagePrice: Number(createdPackage.packagePrice),
    durationMinutes: createdPackage.durationMinutes,

    status: createdPackage.status,
    listingStatus: createdPackage.listingStatus,

    capacity,
    soldQuantity: createdPackage.soldQuantity,
    reservedQuantity: createdPackage.reservedQuantity,
    remainingQuantity,

    purchaseLimitPerCustomer: createdPackage.purchaseLimitPerCustomer,

    salesStartAt: createdPackage.salesStartAt,
    salesEndAt: createdPackage.salesEndAt,

    soldOut: remainingQuantity <= 0,

    serviceIds: uniqueServiceIds,
    branchIds: uniqueBranchIds,
    staffIds: uniqueStaffIds,

    images,
  };
};

const getPackages = async (
  query: Record<string, any>,
  language: Language = DEFAULT_LANGUAGE,
) => {
  // =====================================================
  // 1. PAGINATION
  // =====================================================

  const limit = query.limit !== undefined ? Number(query.limit) : 20;

  const page = query.page !== undefined ? Number(query.page) : 1;

  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new AppError("Limit must be an integer between 1 and 100", 400);
  }

  if (!Number.isSafeInteger(page) || page < 1) {
    throw new AppError("Page must be a positive integer", 400);
  }

  const skip = (page - 1) * limit;

  if (!Number.isSafeInteger(skip)) {
    throw new AppError("Pagination offset is too large", 400);
  }

  // =====================================================
  // 2. GROUP PURCHASE ONLY + OPTIONAL FILTERS
  // =====================================================

  const status = query.status as PackageStatus | undefined;

  const listingStatus = query.listingStatus as ListingStatus | undefined;

  const where: Prisma.PackageWhereInput = {
    type: PackageType.GROUP_PURCHASE_PACKAGE,

    ...(status && {
      status,
    }),

    ...(listingStatus && {
      listingStatus,
    }),
  };

  // =====================================================
  // 3. FETCH GROUP PURCHASE PACKAGES
  // =====================================================

  const [packages, totalPackageCount] = await Promise.all([
    prisma.package.findMany({
      where,

      take: limit,
      skip,

      orderBy: {
        createdAt: "desc",
      },

      include: {
        // ===============================================
        // PRIMARY PACKAGE IMAGE
        // ===============================================

        images: {
          where: {
            isPrimary: true,
          },

          take: 1,

          select: {
            objectKey: true,
          },
        },

        // ===============================================
        // PACKAGE SERVICES
        // ===============================================

        services: {
          select: {
            service: {
              select: {
                id: true,
                name: true,
                translations: true,
              },
            },
          },
        },

        // ===============================================
        // PACKAGE BRANCHES
        // ===============================================

        branches: {
          select: {
            branch: {
              select: {
                id: true,
                name: true,
                translations: true,
              },
            },
          },
        },
      },
    }),

    prisma.package.count({
      where,
    }),
  ]);

  // =====================================================
  // 4. LOCALIZED RESPONSE ITEMS
  // =====================================================

  const items = await Promise.all(
    packages.map(async (item) => {
      // ===============================================
      // LOCALIZE PACKAGE
      // ===============================================

      const localized = localizePackage(item, language);

      // ===============================================
      // GROUP PURCHASE INVENTORY
      // ===============================================

      const capacity = item.capacity;

      // Total unsold quantity, including reservations.
      const remainingQuantity =
        capacity !== null ? Math.max(capacity - item.soldQuantity, 0) : null;

      // Quantity available for new purchases.
      const availableQuantity =
        capacity !== null
          ? Math.max(capacity - item.soldQuantity - item.reservedQuantity, 0)
          : null;

      // Null capacity means unlimited inventory.
      const soldOut =
        capacity !== null &&
        availableQuantity !== null &&
        availableQuantity <= 0;

      // ===============================================
      // PRIMARY IMAGE SIGNED URL
      // ===============================================

      const primaryImageObjectKey = item.images[0]?.objectKey ?? null;

      const primaryImageUrl = primaryImageObjectKey
        ? await uploadService.getImageUrl(primaryImageObjectKey)
        : null;

      // ===============================================
      // RESPONSE
      // ===============================================

      return {
        id: item.id,

        // Fixed GROUP_PURCHASE_PACKAGE type.
        type: item.type,

        // =============================================
        // MULTILINGUAL PACKAGE INFORMATION
        // =============================================

        name: localized.name,

        description: localized.description,

        // =============================================
        // PACKAGE DISPLAY FIELDS
        // =============================================

        validDays: item.validDays,

        applicableFor: localized.applicableFor,

        purchaseNotice: localized.purchaseNotice,

        howToUse: localized.howToUse,

        // =============================================
        // PRICING + DURATION
        // =============================================

        regularPrice: Number(item.regularPrice),

        packagePrice: Number(item.packagePrice),

        durationMinutes: item.durationMinutes,

        // =============================================
        // PACKAGE STATUS
        // =============================================

        status: item.status,

        listingStatus: item.listingStatus,

        // =============================================
        // GROUP PURCHASE INFORMATION
        // =============================================

        capacity,

        soldQuantity: item.soldQuantity,

        remainingQuantity,

        availableQuantity,

        purchaseLimitPerCustomer: item.purchaseLimitPerCustomer,

        salesStartAt: item.salesStartAt,

        salesEndAt: item.salesEndAt,

        soldOut,

        // =============================================
        // PRIMARY IMAGE
        // =============================================

        primaryImageObjectKey,

        primaryImageUrl,

        // =============================================
        // LOCALIZED SERVICES
        // =============================================

        services: item.services.map((serviceItem) => ({
          id: serviceItem.service.id,

          name: localizeName(serviceItem.service, language),
        })),

        // =============================================
        // LOCALIZED BRANCHES
        // =============================================

        branches: item.branches.map((branchItem) => ({
          id: branchItem.branch.id,

          name: localizeName(branchItem.branch, language),
        })),
      };
    }),
  );

  // =====================================================
  // 5. PAGINATION RESPONSE
  // =====================================================

  const totalPages = Math.ceil(totalPackageCount / limit);

  return {
    items,

    pagination: {
      page,

      limit,

      total: totalPackageCount,

      totalPages,

      hasNextPage: page < totalPages,

      hasPreviousPage: page > 1,
    },
  };
};

const getPackageById = async (
  packageId: string,
  language: Language = DEFAULT_LANGUAGE,
) => {
  // =====================================================
  // 1. FETCH GROUP PURCHASE PACKAGE DETAILS
  // =====================================================

  const packageData = await prisma.package.findFirst({
    where: {
      id: packageId,
      type: PackageType.GROUP_PURCHASE_PACKAGE,
    },

    include: {
      // ===============================================
      // PACKAGE IMAGES
      // ===============================================

      images: {
        orderBy: {
          sortOrder: "asc",
        },

        select: {
          id: true,
          objectKey: true,
          isPrimary: true,
          sortOrder: true,
        },
      },

      // ===============================================
      // INCLUDED SERVICES
      // ===============================================

      services: {
        select: {
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

      // ===============================================
      // ASSIGNED BRANCHES
      // ===============================================

      branches: {
        select: {
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
    },
  });

  // =====================================================
  // 2. CHECK GROUP PURCHASE PACKAGE
  // =====================================================

  if (!packageData) {
    throw new AppError("Package not found", 404);
  }

  // =====================================================
  // 3. LOCALIZE PACKAGE INFORMATION
  // =====================================================

  const localized = localizePackage(packageData, language);

  // =====================================================
  // 4. GROUP PURCHASE CAPACITY
  // =====================================================

  const capacity = packageData.capacity;

  // Total units not yet sold (includes pending reservations).
  const remainingQuantity =
    capacity !== null ? Math.max(capacity - packageData.soldQuantity, 0) : null;

  // Units currently available for new purchases.
  // Reserved units are temporarily unavailable.
  const availableQuantity =
    capacity !== null
      ? Math.max(
          capacity - packageData.soldQuantity - packageData.reservedQuantity,
          0,
        )
      : null;

  // Null capacity means unlimited inventory.
  const soldOut =
    capacity !== null && availableQuantity !== null && availableQuantity <= 0;

  // =====================================================
  // 5. GENERATE SIGNED IMAGE URLS
  // =====================================================

  const images = await Promise.all(
    packageData.images.map(async (image) => ({
      id: image.id,

      objectKey: image.objectKey,

      url: await uploadService.getImageUrl(image.objectKey),

      isPrimary: image.isPrimary,

      sortOrder: image.sortOrder,
    })),
  );

  // =====================================================
  // 6. GROUP PURCHASE PACKAGE DETAILS RESPONSE
  // =====================================================

  return {
    id: packageData.id,

    // Fixed group purchase package type.
    type: packageData.type,

    // Both supported purchase flows.
    groupPurchaseOptions: groupPurchaseOptions(),

    // ===============================================
    // MULTILINGUAL PACKAGE INFORMATION
    // ===============================================

    name: localized.name,

    description: localized.description,

    // ===============================================
    // PACKAGE DISPLAY FIELDS
    // ===============================================

    validDays: packageData.validDays,

    applicableFor: localized.applicableFor,

    purchaseNotice: localized.purchaseNotice,

    howToUse: localized.howToUse,

    // ===============================================
    // PACKAGE PRICING
    // ===============================================

    regularPrice: Number(packageData.regularPrice),

    packagePrice: Number(packageData.packagePrice),

    durationMinutes: packageData.durationMinutes,

    // ===============================================
    // PACKAGE STATUS
    // ===============================================

    status: packageData.status,

    listingStatus: packageData.listingStatus,

    // ===============================================
    // GROUP PURCHASE INFORMATION
    // ===============================================

    capacity,

    soldQuantity: packageData.soldQuantity,

    remainingQuantity,

    availableQuantity,

    purchaseLimitPerCustomer: packageData.purchaseLimitPerCustomer,

    salesStartAt: packageData.salesStartAt,

    salesEndAt: packageData.salesEndAt,

    soldOut,

    // ===============================================
    // PACKAGE IMAGES
    // ===============================================

    images,

    // ===============================================
    // LOCALIZED INCLUDED SERVICES
    // ===============================================

    services: packageData.services.map((item) => ({
      id: item.service.id,

      name: localizeName(item.service, language),

      price: Number(item.service.price),

      durationMinutes: item.service.durationMinutes,

      status: item.service.status,
    })),

    // ===============================================
    // LOCALIZED ASSIGNED BRANCHES
    // ===============================================

    branches: packageData.branches.map((item) => ({
      id: item.branch.id,

      name: localizeName(item.branch, language),

      status: item.branch.status,
    })),
  };
};

const updatePackage = async (
  packageId: string,
  payload: IUpdatePackagePayload,
  language: Language = DEFAULT_LANGUAGE,
) => {
  // =====================================================
  // 1. FIND GROUP PURCHASE PACKAGE
  // =====================================================

  const packageData = await prisma.package.findFirst({
    where: {
      id: packageId,
      type: PackageType.GROUP_PURCHASE_PACKAGE,
    },
    include: {
      images: true,
    },
  });

  if (!packageData) {
    throw new AppError("Package not found", 404);
  }

  // =====================================================
  // 2. RESOLVE ENGLISH BASE FIELDS
  // =====================================================

  const nextName = (
    payload.name ??
    payload.translations?.en?.name ??
    packageData.name
  ).trim();

  const nextDescription =
    payload.description !== undefined
      ? payload.description.trim()
      : payload.translations?.en?.description !== undefined
        ? payload.translations.en.description.trim()
        : packageData.description;

  // =====================================================
  // 3. RESOLVE PACKAGE DISPLAY FIELDS
  // =====================================================

  const nextValidDays =
    payload.validDays !== undefined ? payload.validDays : packageData.validDays;

  const normalizeStringArray = (items: string[]) =>
    items.map((item) => item.trim());

  const nextApplicableFor = normalizeStringArray(
    payload.applicableFor ??
      payload.translations?.en?.applicableFor ??
      packageData.applicableFor,
  );

  const nextPurchaseNotice = normalizeStringArray(
    payload.purchaseNotice ??
      payload.translations?.en?.purchaseNotice ??
      packageData.purchaseNotice,
  );

  const nextHowToUse = normalizeStringArray(
    payload.howToUse ??
      payload.translations?.en?.howToUse ??
      packageData.howToUse,
  );

  // =====================================================
  // 4. BUILD MULTILINGUAL TRANSLATIONS
  // =====================================================

  const nextTranslations = buildPackageTranslations(
    packageData.translations,
    payload.translations,
    {
      name: nextName,
      description: nextDescription,
      applicableFor: nextApplicableFor,
      purchaseNotice: nextPurchaseNotice,
      howToUse: nextHowToUse,
    },
  );

  // =====================================================
  // 5. DUPLICATE PACKAGE NAME
  // =====================================================

  const existingPackage = await prisma.package.findFirst({
    where: {
      name: {
        equals: nextName,
        mode: "insensitive",
      },
      NOT: {
        id: packageId,
      },
    },
    select: {
      id: true,
    },
  });

  if (existingPackage) {
    throw new AppError("Package already exists", 409);
  }

  // =====================================================
  // 6. PRICE VALIDATION
  // =====================================================

  const regularPrice = payload.regularPrice ?? Number(packageData.regularPrice);

  const packagePrice = payload.packagePrice ?? Number(packageData.packagePrice);

  if (
    !Number.isFinite(regularPrice) ||
    regularPrice <= 0 ||
    !Number.isFinite(packagePrice) ||
    packagePrice <= 0
  ) {
    throw new AppError(
      "Regular price and package price must be greater than 0",
      400,
    );
  }

  if (packagePrice > regularPrice) {
    throw new AppError(
      "Package price cannot be greater than regular price",
      400,
    );
  }

  // =====================================================
  // 7. VALID DAYS VALIDATION
  // =====================================================

  if (
    nextValidDays !== null &&
    (!Number.isInteger(nextValidDays) || nextValidDays <= 0)
  ) {
    throw new AppError("validDays must be a positive integer or null", 400);
  }

  // =====================================================
  // 8. GROUP PURCHASE SETTINGS
  // =====================================================

  const capacity =
    payload.capacity !== undefined ? payload.capacity : packageData.capacity;

  const purchaseLimit =
    payload.purchaseLimitPerCustomer ?? packageData.purchaseLimitPerCustomer;

  const salesStartAt =
    payload.salesStartAt !== undefined
      ? new Date(payload.salesStartAt)
      : packageData.salesStartAt;

  const salesEndAt =
    payload.salesEndAt !== undefined
      ? new Date(payload.salesEndAt)
      : packageData.salesEndAt;

  // =====================================================
  // 9. CAPACITY VALIDATION
  // =====================================================

  if (capacity === null || !Number.isInteger(capacity) || capacity <= 0) {
    throw new AppError(
      "Group purchase capacity must be a positive integer",
      400,
    );
  }

  const committedQuantity =
    packageData.soldQuantity + packageData.reservedQuantity;

  if (capacity < committedQuantity) {
    throw new AppError(
      "Capacity cannot be lower than sold and reserved quantity",
      400,
    );
  }

  // =====================================================
  // 10. PURCHASE LIMIT VALIDATION
  // =====================================================

  if (
    purchaseLimit === null ||
    !Number.isInteger(purchaseLimit) ||
    purchaseLimit <= 0
  ) {
    throw new AppError(
      "Purchase limit per customer must be a positive integer",
      400,
    );
  }

  if (purchaseLimit > capacity) {
    throw new AppError(
      "Purchase limit per customer cannot exceed package capacity",
      400,
    );
  }

  // =====================================================
  // 11. SALES DATE VALIDATION
  // =====================================================

  if (
    !salesStartAt ||
    !salesEndAt ||
    Number.isNaN(salesStartAt.getTime()) ||
    Number.isNaN(salesEndAt.getTime())
  ) {
    throw new AppError("Valid sales start and end times are required", 400);
  }

  if (salesStartAt >= salesEndAt) {
    throw new AppError(
      "Sales end time must be later than sales start time",
      400,
    );
  }

  // =====================================================
  // 12. IMAGE VALIDATION
  // =====================================================

  let uniqueImageObjectKeys: string[] | undefined;

  if (payload.imageObjectKeys !== undefined) {
    const normalizedImageObjectKeys = payload.imageObjectKeys.map((key) =>
      key.trim(),
    );

    if (normalizedImageObjectKeys.some((key) => !key)) {
      throw new AppError("Invalid package image object key", 400);
    }

    uniqueImageObjectKeys = [...new Set(normalizedImageObjectKeys)];

    if (uniqueImageObjectKeys.length !== normalizedImageObjectKeys.length) {
      throw new AppError("Duplicate package images are not allowed", 400);
    }

    const existingImageKeys = new Set(
      packageData.images.map((image) => image.objectKey),
    );

    const expectedPrefix = `packages/${packageId}/`;

    const invalidImage = uniqueImageObjectKeys.find(
      (objectKey) =>
        !existingImageKeys.has(objectKey) &&
        !objectKey.startsWith(expectedPrefix),
    );

    if (invalidImage) {
      throw new AppError("Invalid package image object key", 400);
    }

    await Promise.all(
      uniqueImageObjectKeys.map((objectKey) =>
        uploadService.verifyImageExists(objectKey),
      ),
    );
  }

  // =====================================================
  // 13. UPDATE PACKAGE + IMAGES
  // =====================================================

  const updatedPackage = await prisma.$transaction(
    async (tx) => {
      // Re-read current inventory inside the transaction.
      const currentPackage = await tx.package.findFirst({
        where: {
          id: packageId,
          type: PackageType.GROUP_PURCHASE_PACKAGE,
        },
        select: {
          id: true,
          soldQuantity: true,
          reservedQuantity: true,
        },
      });

      if (!currentPackage) {
        throw new AppError("Package not found", 404);
      }

      const currentCommittedQuantity =
        currentPackage.soldQuantity + currentPackage.reservedQuantity;

      if (capacity < currentCommittedQuantity) {
        throw new AppError(
          "Capacity cannot be lower than sold and reserved quantity",
          400,
        );
      }

      // Optimistic concurrency guard:
      // The update succeeds only if inventory counters
      // have not changed since the transaction read.
      const updateResult = await tx.package.updateMany({
        where: {
          id: packageId,
          type: PackageType.GROUP_PURCHASE_PACKAGE,
          soldQuantity: currentPackage.soldQuantity,
          reservedQuantity: currentPackage.reservedQuantity,
        },
        data: {
          // ENGLISH BASE
          name: nextName,
          description: nextDescription,

          // MULTILINGUAL
          translations: nextTranslations,

          // DISPLAY FIELDS
          validDays: nextValidDays,
          applicableFor: nextApplicableFor,
          purchaseNotice: nextPurchaseNotice,
          howToUse: nextHowToUse,

          // PRICING
          ...(payload.regularPrice !== undefined && {
            regularPrice: payload.regularPrice,
          }),

          ...(payload.packagePrice !== undefined && {
            packagePrice: payload.packagePrice,
          }),

          ...(payload.durationMinutes !== undefined && {
            durationMinutes: payload.durationMinutes,
          }),

          // GROUP PURCHASE
          ...(payload.capacity !== undefined && {
            capacity: payload.capacity,
          }),

          ...(payload.purchaseLimitPerCustomer !== undefined && {
            purchaseLimitPerCustomer: payload.purchaseLimitPerCustomer,
          }),

          ...(payload.salesStartAt !== undefined && {
            salesStartAt,
          }),

          ...(payload.salesEndAt !== undefined && {
            salesEndAt,
          }),
        },
      });

      if (updateResult.count !== 1) {
        throw new AppError(
          "Package inventory changed. Please retry the update",
          409,
        );
      }

      // ================================================
      // REPLACE PACKAGE IMAGES
      // ================================================

      if (uniqueImageObjectKeys !== undefined) {
        await tx.packageImage.deleteMany({
          where: {
            packageId,
          },
        });

        if (uniqueImageObjectKeys.length > 0) {
          await tx.packageImage.createMany({
            data: uniqueImageObjectKeys.map((objectKey, index) => ({
              packageId,
              objectKey,
              isPrimary: index === 0,
              sortOrder: index,
            })),
          });
        }
      }

      // ================================================
      // FETCH UPDATED PACKAGE
      // ================================================

      return tx.package.findUnique({
        where: {
          id: packageId,
        },
        include: {
          images: {
            orderBy: {
              sortOrder: "asc",
            },
          },
        },
      });
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    },
  );

  if (!updatedPackage) {
    throw new AppError("Package not found after update", 404);
  }

  // =====================================================
  // 14. LOCALIZED RESPONSE
  // =====================================================

  const localized = localizePackage(updatedPackage, language);

  const updatedCapacity = updatedPackage.capacity;

  const remainingQuantity =
    updatedCapacity !== null
      ? Math.max(updatedCapacity - updatedPackage.soldQuantity, 0)
      : null;

  const availableQuantity =
    updatedCapacity !== null
      ? Math.max(
          updatedCapacity -
            updatedPackage.soldQuantity -
            updatedPackage.reservedQuantity,
          0,
        )
      : null;

  const soldOut =
    updatedCapacity !== null &&
    availableQuantity !== null &&
    availableQuantity <= 0;

  return {
    id: updatedPackage.id,
    type: updatedPackage.type,

    name: localized.name,
    description: localized.description,

    validDays: updatedPackage.validDays,
    applicableFor: localized.applicableFor,
    purchaseNotice: localized.purchaseNotice,
    howToUse: localized.howToUse,

    regularPrice: Number(updatedPackage.regularPrice),
    packagePrice: Number(updatedPackage.packagePrice),
    durationMinutes: updatedPackage.durationMinutes,

    status: updatedPackage.status,
    listingStatus: updatedPackage.listingStatus,

    capacity: updatedPackage.capacity,
    soldQuantity: updatedPackage.soldQuantity,
    reservedQuantity: updatedPackage.reservedQuantity,
    remainingQuantity,
    availableQuantity,

    purchaseLimitPerCustomer: updatedPackage.purchaseLimitPerCustomer,

    salesStartAt: updatedPackage.salesStartAt,
    salesEndAt: updatedPackage.salesEndAt,

    soldOut,

    images: updatedPackage.images.map((image) => ({
      id: image.id,
      objectKey: image.objectKey,
      isPrimary: image.isPrimary,
      sortOrder: image.sortOrder,
    })),
  };
};

// =====================================================
// UPDATE GROUP PURCHASE REFUND POLICY
// =====================================================

const updatePackageStatus = async (
  packageId: string,
  payload: IUpdatePackageStatusPayload,
  userId: string,
) => {
  // =====================================================
  // 1. FIND GROUP PURCHASE PACKAGE
  // =====================================================

  const packageData = await prisma.package.findFirst({
    where: {
      id: packageId,
      type: PackageType.GROUP_PURCHASE_PACKAGE,
    },
  });

  if (!packageData) {
    throw new AppError("Package not found", 404);
  }

  // =====================================================
  // 2. SAME STATUS — NO UPDATE / NO AUDIT
  // =====================================================

  if (packageData.status === payload.status) {
    return {
      id: packageData.id,
      status: packageData.status,
    };
  }

  // =====================================================
  // 3. UPDATE STATUS + AUDIT LOG
  // =====================================================

  const updatedPackage = await prisma.$transaction(async (tx) => {
    const result = await tx.package.update({
      where: {
        id: packageId,
        type: PackageType.GROUP_PURCHASE_PACKAGE,
      },

      data: {
        status: payload.status,
      },
    });

    await auditLogService.createAuditLog(
      {
        userId,

        action: "PACKAGE_STATUS_CHANGED",

        entityType: "PACKAGE",

        entityId: packageId,

        metadata: {
          previousStatus: packageData.status,
          newStatus: result.status,
        },
      },
      tx,
    );

    return result;
  });

  // =====================================================
  // 4. RESPONSE
  // =====================================================

  return {
    id: updatedPackage.id,
    status: updatedPackage.status,
  };
};

const updatePackageListing = async (
  packageId: string,
  payload: IUpdatePackageListingPayload,
  userId: string,
) => {
  // =====================================================
  // 1. FIND GROUP PURCHASE PACKAGE
  // =====================================================

  const packageData = await prisma.package.findFirst({
    where: {
      id: packageId,
      type: PackageType.GROUP_PURCHASE_PACKAGE,
    },
  });

  if (!packageData) {
    throw new AppError("Package not found", 404);
  }

  // =====================================================
  // 2. SAME LISTING STATUS — NO UPDATE / NO AUDIT
  // =====================================================

  if (packageData.listingStatus === payload.listingStatus) {
    return {
      id: packageData.id,
      listingStatus: packageData.listingStatus,
    };
  }

  // =====================================================
  // 3. UPDATE LISTING STATUS + AUDIT LOG
  // =====================================================

  const updatedPackage = await prisma.$transaction(async (tx) => {
    const result = await tx.package.update({
      where: {
        id: packageId,
        type: PackageType.GROUP_PURCHASE_PACKAGE,
      },

      data: {
        listingStatus: payload.listingStatus,
      },
    });

    await auditLogService.createAuditLog(
      {
        userId,

        action: "PACKAGE_LISTING_CHANGED",

        entityType: "PACKAGE",

        entityId: packageId,

        metadata: {
          previousListingStatus: packageData.listingStatus,

          newListingStatus: result.listingStatus,
        },
      },
      tx,
    );

    return result;
  });

  // =====================================================
  // 4. RESPONSE
  // =====================================================

  return {
    id: updatedPackage.id,
    listingStatus: updatedPackage.listingStatus,
  };
};

const assignPackageToBranches = async (
  packageId: string,
  payload: IAssignPackageBranchesPayload,
) => {
  // =====================================================
  // 1. FIND GROUP PURCHASE PACKAGE
  // =====================================================

  const packageData = await prisma.package.findFirst({
    where: {
      id: packageId,
      type: PackageType.GROUP_PURCHASE_PACKAGE,
    },

    include: {
      // ===============================================
      // PACKAGE SERVICES
      // ===============================================

      services: {
        select: {
          service: {
            select: {
              id: true,
              status: true,

              branches: {
                select: {
                  branchId: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!packageData) {
    throw new AppError("Package not found", 404);
  }

  // =====================================================
  // 2. VALIDATE BRANCH IDS
  // =====================================================

  const uniqueBranchIds = [...new Set(payload.branchIds)];

  if (uniqueBranchIds.length !== payload.branchIds.length) {
    throw new AppError("Duplicate branch IDs are not allowed", 400);
  }

  if (uniqueBranchIds.length === 0) {
    throw new AppError("At least one branch is required", 400);
  }

  // =====================================================
  // 3. CHECK BRANCHES
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
    throw new AppError("Package cannot be assigned to an inactive branch", 400);
  }

  // =====================================================
  // 4. VALIDATE PACKAGE SERVICES
  // =====================================================

  if (packageData.services.length === 0) {
    throw new AppError("Package must contain at least one service", 400);
  }

  for (const packageService of packageData.services) {
    const service = packageService.service;

    if (service.status !== ServiceStatus.ACTIVE) {
      throw new AppError(
        "Inactive services cannot be included in an active package assignment",
        400,
      );
    }

    const serviceBranchIds = new Set(
      service.branches.map((serviceBranch) => serviceBranch.branchId),
    );

    const unavailableBranch = uniqueBranchIds.find(
      (branchId) => !serviceBranchIds.has(branchId),
    );

    if (unavailableBranch) {
      throw new AppError(
        "All package services must be available in every assigned branch",
        400,
      );
    }
  }

  // =====================================================
  // 5. VALIDATE EXISTING PACKAGE STAFF
  // =====================================================

  const assignedStaff = await prisma.staffPackage.findMany({
    where: {
      packageId,
    },

    select: {
      staff: {
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
      },
    },
  });

  const selectedBranchIds = new Set(uniqueBranchIds);

  const packageServiceIds = packageData.services.map((item) => item.service.id);

  for (const assignment of assignedStaff) {
    const staff = assignment.staff;

    // Staff must remain active.

    if (staff.status !== StaffStatus.ACTIVE) {
      throw new AppError(
        `Inactive staff cannot remain assigned to package: ${staff.name}`,
        400,
      );
    }

    // Staff must belong to at least one selected branch.

    const hasMatchingBranch = staff.branches.some((branch) =>
      selectedBranchIds.has(branch.branchId),
    );

    if (!hasMatchingBranch) {
      throw new AppError(
        `Staff "${staff.name}" is not assigned to any selected package branch`,
        400,
      );
    }

    // Staff must support all package services.

    const staffServiceIds = new Set(
      staff.services.map((service) => service.serviceId),
    );

    const missingService = packageServiceIds.find(
      (serviceId) => !staffServiceIds.has(serviceId),
    );

    if (missingService) {
      throw new AppError(
        `Staff "${staff.name}" must support all services included in this package`,
        400,
      );
    }
  }

  // =====================================================
  // 6. REPLACE PACKAGE BRANCH ASSIGNMENTS
  // =====================================================

  await prisma.$transaction(async (tx) => {
    // Recheck package type inside transaction.

    const currentPackage = await tx.package.findFirst({
      where: {
        id: packageId,
        type: PackageType.GROUP_PURCHASE_PACKAGE,
      },

      select: {
        id: true,
      },
    });

    if (!currentPackage) {
      throw new AppError("Package not found", 404);
    }

    await tx.packageBranch.deleteMany({
      where: {
        packageId,
      },
    });

    await tx.packageBranch.createMany({
      data: uniqueBranchIds.map((branchId) => ({
        packageId,
        branchId,
      })),
    });
  });

  // =====================================================
  // 7. RESPONSE
  // =====================================================

  return {
    packageId,
    branchIds: uniqueBranchIds,
  };
};

const getBranchPackages = async (
  branchId: string,
  query: Record<string, any>,
  language: Language = DEFAULT_LANGUAGE,
) => {
  // =====================================================
  // 1. PAGINATION
  // =====================================================

  const limit = query.limit !== undefined ? Number(query.limit) : 20;

  const page = query.page !== undefined ? Number(query.page) : 1;

  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new AppError("Limit must be an integer between 1 and 100", 400);
  }

  if (!Number.isSafeInteger(page) || page < 1) {
    throw new AppError("Page must be a positive integer", 400);
  }

  const skip = (page - 1) * limit;

  if (!Number.isSafeInteger(skip)) {
    throw new AppError("Pagination offset is too large", 400);
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
      status: true,
    },
  });

  if (!branch) {
    throw new AppError("Branch not found", 404);
  }

  if (branch.status !== BranchStatus.ACTIVE) {
    throw new AppError("Branch is inactive", 400);
  }

  // =====================================================
  // 3. BUILD GROUP PURCHASE PACKAGE FILTER
  // =====================================================

  const where: Prisma.PackageWhereInput = {
    type: PackageType.GROUP_PURCHASE_PACKAGE,

    status: PackageStatus.ACTIVE,

    listingStatus: ListingStatus.LISTED,

    branches: {
      some: {
        branchId,
      },
    },
  };

  // =====================================================
  // 4. FETCH BRANCH GROUP PURCHASE PACKAGES
  // =====================================================

  const [packages, totalPackageCount] = await Promise.all([
    prisma.package.findMany({
      where,

      take: limit,
      skip,

      orderBy: {
        createdAt: "desc",
      },

      include: {
        // ===============================================
        // PRIMARY IMAGE
        // ===============================================

        images: {
          where: {
            isPrimary: true,
          },

          take: 1,

          select: {
            objectKey: true,
          },
        },

        // ===============================================
        // INCLUDED SERVICES
        // ===============================================

        services: {
          select: {
            service: {
              select: {
                id: true,
                name: true,
                translations: true,
              },
            },
          },
        },
      },
    }),

    prisma.package.count({
      where,
    }),
  ]);

  const now = new Date();

  // =====================================================
  // 5. LOCALIZED RESPONSE ITEMS
  // =====================================================

  const items = await Promise.all(
    packages.map(async (item) => {
      // ===============================================
      // LOCALIZE PACKAGE
      // ===============================================

      const localized = localizePackage(item, language);

      // ===============================================
      // GROUP PURCHASE INVENTORY
      // ===============================================

      const capacity = item.capacity;

      // Total unsold units, including reserved units.
      const remainingQuantity =
        capacity !== null ? Math.max(capacity - item.soldQuantity, 0) : null;

      // Currently available inventory after reservations.
      const availableQuantity =
        capacity !== null
          ? Math.max(capacity - item.soldQuantity - item.reservedQuantity, 0)
          : null;

      // Unlimited capacity cannot be sold out.
      const soldOut =
        capacity !== null &&
        availableQuantity !== null &&
        availableQuantity <= 0;

      // ===============================================
      // GROUP PURCHASE AVAILABILITY
      // ===============================================

      // Preserve existing sales-window requirements.
      const purchaseAvailable =
        !soldOut &&
        item.salesStartAt !== null &&
        item.salesEndAt !== null &&
        now >= item.salesStartAt &&
        now <= item.salesEndAt;

      // ===============================================
      // PRIMARY IMAGE SIGNED URL
      // ===============================================

      const primaryImageObjectKey = item.images[0]?.objectKey ?? null;

      const primaryImageUrl = primaryImageObjectKey
        ? await uploadService.getImageUrl(primaryImageObjectKey)
        : null;

      // ===============================================
      // RESPONSE
      // ===============================================

      return {
        id: item.id,

        // Fixed Group Purchase Package type.
        type: item.type,

        // =============================================
        // MULTILINGUAL PACKAGE INFORMATION
        // =============================================

        name: localized.name,

        description: localized.description,

        // =============================================
        // PACKAGE DISPLAY FIELDS
        // =============================================

        validDays: item.validDays,

        applicableFor: localized.applicableFor,

        purchaseNotice: localized.purchaseNotice,

        howToUse: localized.howToUse,

        // =============================================
        // PRICING AND DURATION
        // =============================================

        regularPrice: Number(item.regularPrice),

        packagePrice: Number(item.packagePrice),

        durationMinutes: item.durationMinutes,

        // =============================================
        // PRIMARY IMAGE
        // =============================================

        primaryImageObjectKey,

        primaryImageUrl,

        // =============================================
        // LOCALIZED INCLUDED SERVICES
        // =============================================

        services: item.services.map((serviceItem) => ({
          id: serviceItem.service.id,

          name: localizeName(serviceItem.service, language),
        })),

        // =============================================
        // GROUP PURCHASE INFORMATION
        // =============================================

        capacity,

        soldQuantity: item.soldQuantity,

        remainingQuantity,

        availableQuantity,

        purchaseLimitPerCustomer: item.purchaseLimitPerCustomer,

        salesStartAt: item.salesStartAt,

        salesEndAt: item.salesEndAt,

        soldOut,

        purchaseAvailable,
      };
    }),
  );

  // =====================================================
  // 6. PAGINATION RESPONSE
  // =====================================================

  const totalPages = Math.ceil(totalPackageCount / limit);

  return {
    items,

    pagination: {
      page,

      limit,

      total: totalPackageCount,

      totalPages,

      hasNextPage: page < totalPages,

      hasPreviousPage: page > 1,
    },
  };
};

// =====================================================
// UPDATE GROUP PURCHASE CANCELLATION POLICY
// =====================================================

export const packageService = {
  createPackage,
  getPackages,
  getPackageById,
  updatePackage,
  updatePackageStatus,
  updatePackageListing,
  assignPackageToBranches,
  getBranchPackages,
};
