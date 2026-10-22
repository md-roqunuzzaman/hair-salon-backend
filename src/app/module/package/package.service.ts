import {
  BranchStatus,
  ListingStatus,
  PackageStatus,
  PackageType,
  Prisma,
  Role,
  ServiceStatus,
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
  // 3. DUPLICATE PACKAGE NAME
  // =====================================================

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
  // 4. UNIQUE SERVICE IDS
  // =====================================================

  const uniqueServiceIds = [...new Set(payload.serviceIds)];

  if (uniqueServiceIds.length !== payload.serviceIds.length) {
    throw new AppError("Duplicate service IDs are not allowed", 400);
  }

  // =====================================================
  // 5. UNIQUE BRANCH IDS
  // =====================================================

  const uniqueBranchIds = [...new Set(payload.branchIds)];

  if (uniqueBranchIds.length !== payload.branchIds.length) {
    throw new AppError("Duplicate branch IDs are not allowed", 400);
  }

  // =====================================================
  // 6. VALIDATE OPTIONAL IMAGE OBJECT KEYS
  // =====================================================

  // Images are optional.
  // Missing imageObjectKeys will be treated as [].

  const imageObjectKeys = (payload.imageObjectKeys ?? []).map((key) =>
    key.trim(),
  );

  if (imageObjectKeys.some((key) => !key)) {
    throw new AppError("Invalid image object key", 400);
  }

  const uniqueImageObjectKeys = [...new Set(imageObjectKeys)];

  if (uniqueImageObjectKeys.length !== imageObjectKeys.length) {
    throw new AppError("Duplicate package images are not allowed", 400);
  }

  // =====================================================
  // 7. CHECK SERVICES
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
  // 8. CHECK BRANCHES
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
  // 9. SERVICES MUST EXIST IN EVERY PACKAGE BRANCH
  // =====================================================

  for (const service of services) {
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
  // 10. PRICE VALIDATION
  // =====================================================

  if (payload.packagePrice > payload.regularPrice) {
    throw new AppError(
      "Package price cannot be greater than regular price",
      400,
    );
  }

  // =====================================================
  // 11. GROUP PURCHASE VALIDATION
  // =====================================================

  if (payload.type === PackageType.GROUP_PURCHASE_PACKAGE) {
    if (
      !payload.capacity ||
      !payload.purchaseLimitPerCustomer ||
      !payload.salesStartAt ||
      !payload.salesEndAt
    ) {
      throw new AppError(
        "Group purchase package configuration is incomplete",
        400,
      );
    }

    if (new Date(payload.salesStartAt) >= new Date(payload.salesEndAt)) {
      throw new AppError(
        "Sales end time must be later than sales start time",
        400,
      );
    }

    if (payload.purchaseLimitPerCustomer > payload.capacity) {
      throw new AppError(
        "Purchase limit per customer cannot exceed package capacity",
        400,
      );
    }
  }

  // =====================================================
  // 12. CREATE PACKAGE + RELATIONS + OPTIONAL IMAGES
  // =====================================================

  const createdPackage = await prisma.$transaction(async (tx) => {
    // =================================================
    // CREATE PACKAGE
    // =================================================

    const packageData = await tx.package.create({
      data: {
        type: payload.type,

        name: packageName,
        description: packageDescription,

        translations,

        // =============================================
        // PACKAGE DISPLAY FIELDS
        // =============================================

        validDays,
        applicableFor,
        purchaseNotice,
        howToUse,

        // =============================================
        // PRICING
        // =============================================

        regularPrice: payload.regularPrice,
        packagePrice: payload.packagePrice,
        durationMinutes: payload.durationMinutes,

        listingStatus: payload.listingStatus,

        // =============================================
        // GROUP PURCHASE SETTINGS
        // =============================================

        capacity:
          payload.type === PackageType.GROUP_PURCHASE_PACKAGE
            ? payload.capacity
            : null,

        soldQuantity: 0,

        purchaseLimitPerCustomer:
          payload.type === PackageType.GROUP_PURCHASE_PACKAGE
            ? payload.purchaseLimitPerCustomer
            : null,

        salesStartAt:
          payload.type === PackageType.GROUP_PURCHASE_PACKAGE &&
          payload.salesStartAt
            ? new Date(payload.salesStartAt)
            : null,

        salesEndAt:
          payload.type === PackageType.GROUP_PURCHASE_PACKAGE &&
          payload.salesEndAt
            ? new Date(payload.salesEndAt)
            : null,
      },
    });

    // =================================================
    // ASSIGN SERVICES
    // =================================================

    await tx.packageService.createMany({
      data: uniqueServiceIds.map((serviceId) => ({
        packageId: packageData.id,
        serviceId,
      })),
    });

    // =================================================
    // ASSIGN BRANCHES
    // =================================================

    await tx.packageBranch.createMany({
      data: uniqueBranchIds.map((branchId) => ({
        packageId: packageData.id,
        branchId,
      })),
    });

    // =================================================
    // SAVE PACKAGE IMAGES (OPTIONAL)
    // =================================================

    // Only create image records when images are provided.

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

    // =================================================
    // FETCH SAVED IMAGES
    // =================================================

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
  // 13. FORMAT IMAGE RESPONSE
  // =====================================================

  // Returns [] when the package has no images.

  const images = createdPackage.images.map((image) => ({
    id: image.id,
    objectKey: image.objectKey,
    isPrimary: image.isPrimary,
    sortOrder: image.sortOrder,
  }));

  // =====================================================
  // 14. STANDARD PACKAGE RESPONSE
  // =====================================================

  if (createdPackage.type === PackageType.STANDARD_SERVICE_PACKAGE) {
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

      images,
    };
  }

  // =====================================================
  // 15. GROUP PURCHASE RESPONSE
  // =====================================================

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

    capacity,
    soldQuantity: createdPackage.soldQuantity,
    remainingQuantity,

    status: createdPackage.status,
    listingStatus: createdPackage.listingStatus,

    soldOut: remainingQuantity <= 0,

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

  const limit = query.limit ? Number(query.limit) : 20;
  const page = query.page ? Number(query.page) : 1;
  const skip = (page - 1) * limit;

  // =====================================================
  // 2. FILTERS
  // =====================================================

  const type = query.type as PackageType | undefined;
  const status = query.status as PackageStatus | undefined;
  const listingStatus = query.listingStatus as ListingStatus | undefined;

  const andConditions: Prisma.PackageWhereInput[] = [];

  if (type) {
    andConditions.push({ type });
  }

  if (status) {
    andConditions.push({ status });
  }

  if (listingStatus) {
    andConditions.push({ listingStatus });
  }

  // =====================================================
  // 3. FETCH PACKAGES
  // =====================================================

  const [packages, totalPackageCount] = await Promise.all([
    prisma.package.findMany({
      where: {
        AND: andConditions,
      },

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
      where: {
        AND: andConditions,
      },
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
      // CAPACITY + REMAINING QUANTITY
      // ===============================================

      const capacity = item.capacity ?? null;

      const remainingQuantity =
        capacity !== null ? capacity - item.soldQuantity : null;

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

        type: item.type,

        // =============================================
        // MULTILINGUAL PACKAGE INFORMATION
        // =============================================

        name: localized.name,

        description: localized.description,

        // =============================================
        // NEW PACKAGE DISPLAY FIELDS
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

        soldOut:
          item.type === PackageType.GROUP_PURCHASE_PACKAGE
            ? remainingQuantity !== null && remainingQuantity <= 0
            : false,

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
  // 1. FETCH PACKAGE DETAILS
  // =====================================================

  const packageData = await prisma.package.findUnique({
    where: {
      id: packageId,
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
  // 2. CHECK PACKAGE
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

  const capacity = packageData.capacity ?? null;

  const remainingQuantity =
    capacity !== null ? capacity - packageData.soldQuantity : null;

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
  // 6. PACKAGE DETAILS RESPONSE
  // =====================================================

  return {
    id: packageData.id,

    type: packageData.type,
    ...(packageData.type === PackageType.GROUP_PURCHASE_PACKAGE && {
      groupPurchaseOptions: groupPurchaseOptions(),
    }),

    // ===============================================
    // MULTILINGUAL PACKAGE INFORMATION
    // ===============================================

    name: localized.name,

    description: localized.description,

    // ===============================================
    // NEW PACKAGE DISPLAY FIELDS
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

    purchaseLimitPerCustomer: packageData.purchaseLimitPerCustomer,

    salesStartAt: packageData.salesStartAt,

    salesEndAt: packageData.salesEndAt,

    soldOut:
      packageData.type === PackageType.GROUP_PURCHASE_PACKAGE
        ? remainingQuantity !== null && remainingQuantity <= 0
        : false,

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
  // 1. FIND PACKAGE
  // =====================================================

  const packageData = await prisma.package.findUnique({
    where: {
      id: packageId,
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
  // 3. RESOLVE NEW PACKAGE DISPLAY FIELDS
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
  // 5. DUPLICATE NAME
  // =====================================================

  if (nextName !== packageData.name) {
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
    });

    if (existingPackage) {
      throw new AppError("Package already exists", 409);
    }
  }

  // =====================================================
  // 6. PRICE VALIDATION
  // =====================================================

  const regularPrice = payload.regularPrice ?? Number(packageData.regularPrice);

  const packagePrice = payload.packagePrice ?? Number(packageData.packagePrice);

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
  // 8. STANDARD PACKAGE VALIDATION
  // =====================================================

  if (
    packageData.type === PackageType.STANDARD_SERVICE_PACKAGE &&
    (payload.capacity !== undefined ||
      payload.purchaseLimitPerCustomer !== undefined ||
      payload.salesStartAt !== undefined ||
      payload.salesEndAt !== undefined)
  ) {
    throw new AppError(
      "Group purchase fields are not allowed for standard packages",
      400,
    );
  }

  // =====================================================
  // 9. GROUP PURCHASE VALIDATION
  // =====================================================

  if (packageData.type === PackageType.GROUP_PURCHASE_PACKAGE) {
    const capacity = payload.capacity ?? packageData.capacity;

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

    if (capacity !== null && capacity < packageData.soldQuantity) {
      throw new AppError("Capacity cannot be lower than sold quantity", 400);
    }

    if (
      capacity !== null &&
      purchaseLimit !== null &&
      purchaseLimit > capacity
    ) {
      throw new AppError(
        "Purchase limit per customer cannot exceed package capacity",
        400,
      );
    }

    if (salesStartAt && salesEndAt && salesStartAt >= salesEndAt) {
      throw new AppError(
        "Sales end time must be later than sales start time",
        400,
      );
    }
  }

  // =====================================================
  // 10. IMAGE VALIDATION
  // =====================================================

  let uniqueImageObjectKeys: string[] | undefined;

  if (payload.imageObjectKeys !== undefined) {
    uniqueImageObjectKeys = [...new Set(payload.imageObjectKeys)];

    if (uniqueImageObjectKeys.length !== payload.imageObjectKeys.length) {
      throw new AppError("Duplicate package images are not allowed", 400);
    }

    const expectedPrefix = `packages/${packageId}/`;

    const invalidImage = uniqueImageObjectKeys.find(
      (objectKey) => !objectKey.startsWith(expectedPrefix),
    );

    if (invalidImage) {
      throw new AppError("Invalid package image object key", 400);
    }

    // VERIFY R2 OBJECTS EXIST

    await Promise.all(
      uniqueImageObjectKeys.map((objectKey) =>
        uploadService.verifyImageExists(objectKey),
      ),
    );
  }

  // =====================================================
  // 11. UPDATE PACKAGE + IMAGES
  // =====================================================

  const updatedPackage = await prisma.$transaction(async (tx) => {
    await tx.package.update({
      where: {
        id: packageId,
      },

      data: {
        // ===========================================
        // ENGLISH BASE
        // ===========================================

        name: nextName,

        description: nextDescription,

        // ===========================================
        // MULTILINGUAL
        // ===========================================

        translations: nextTranslations,

        // ===========================================
        // NEW PACKAGE DISPLAY FIELDS
        // ===========================================

        validDays: nextValidDays,

        applicableFor: nextApplicableFor,

        purchaseNotice: nextPurchaseNotice,

        howToUse: nextHowToUse,

        // ===========================================
        // PRICING
        // ===========================================

        ...(payload.regularPrice !== undefined && {
          regularPrice: payload.regularPrice,
        }),

        ...(payload.packagePrice !== undefined && {
          packagePrice: payload.packagePrice,
        }),

        ...(payload.durationMinutes !== undefined && {
          durationMinutes: payload.durationMinutes,
        }),

        // ===========================================
        // GROUP PURCHASE
        // ===========================================

        ...(packageData.type === PackageType.GROUP_PURCHASE_PACKAGE && {
          ...(payload.capacity !== undefined && {
            capacity: payload.capacity,
          }),

          ...(payload.purchaseLimitPerCustomer !== undefined && {
            purchaseLimitPerCustomer: payload.purchaseLimitPerCustomer,
          }),

          ...(payload.salesStartAt !== undefined && {
            salesStartAt: new Date(payload.salesStartAt),
          }),

          ...(payload.salesEndAt !== undefined && {
            salesEndAt: new Date(payload.salesEndAt),
          }),
        }),
      },
    });

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

    return await tx.package.findUnique({
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
  });

  if (!updatedPackage) {
    throw new AppError("Package not found after update", 404);
  }

  // =====================================================
  // 12. LOCALIZED RESPONSE
  // =====================================================

  const localized = localizePackage(updatedPackage, language);

  return {
    id: updatedPackage.id,

    type: updatedPackage.type,

    name: localized.name,

    description: localized.description,

    // NEW DISPLAY FIELDS

    validDays: updatedPackage.validDays,

    applicableFor: localized.applicableFor,

    purchaseNotice: localized.purchaseNotice,

    howToUse: localized.howToUse,

    // PRICING

    regularPrice: Number(updatedPackage.regularPrice),

    packagePrice: Number(updatedPackage.packagePrice),

    durationMinutes: updatedPackage.durationMinutes,

    status: updatedPackage.status,

    listingStatus: updatedPackage.listingStatus,

    // GROUP PURCHASE

    capacity: updatedPackage.capacity,

    soldQuantity: updatedPackage.soldQuantity,

    purchaseLimitPerCustomer: updatedPackage.purchaseLimitPerCustomer,

    salesStartAt: updatedPackage.salesStartAt,

    salesEndAt: updatedPackage.salesEndAt,

    // IMAGES

    images: updatedPackage.images.map((image) => ({
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
  const packageData = await prisma.package.findUnique({
    where: {
      id: packageId,
    },
  });

  if (!packageData) {
    throw new AppError("Package not found", 404);
  }

  // =====================================================
  // SAME STATUS — NO UPDATE / NO AUDIT
  // =====================================================

  if (packageData.status === payload.status) {
    return {
      id: packageData.id,
      status: packageData.status,
    };
  }

  // =====================================================
  // UPDATE + AUDIT
  // =====================================================

  const updatedPackage = await prisma.$transaction(async (tx) => {
    const result = await tx.package.update({
      where: {
        id: packageId,
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
  const packageData = await prisma.package.findUnique({
    where: {
      id: packageId,
    },
  });

  if (!packageData) {
    throw new AppError("Package not found", 404);
  }

  // =====================================================
  // SAME LISTING STATUS — NO UPDATE / NO AUDIT
  // =====================================================

  if (packageData.listingStatus === payload.listingStatus) {
    return {
      id: packageData.id,
      listingStatus: packageData.listingStatus,
    };
  }

  // =====================================================
  // UPDATE + AUDIT
  // =====================================================

  const updatedPackage = await prisma.$transaction(async (tx) => {
    const result = await tx.package.update({
      where: {
        id: packageId,
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

  return {
    id: updatedPackage.id,
    listingStatus: updatedPackage.listingStatus,
  };
};

const assignPackageToBranches = async (
  packageId: string,
  payload: IAssignPackageBranchesPayload,
) => {
  const packageData = await prisma.package.findUnique({
    where: {
      id: packageId,
    },
    include: {
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

  const uniqueBranchIds = [...new Set(payload.branchIds)];

  if (uniqueBranchIds.length !== payload.branchIds.length) {
    throw new AppError("Duplicate branch IDs are not allowed", 400);
  }

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

  const inactiveBranch = branches.find((branch) => branch.status !== "ACTIVE");

  if (inactiveBranch) {
    throw new AppError("Package cannot be assigned to an inactive branch", 400);
  }

  for (const packageService of packageData.services) {
    const service = packageService.service;

    if (service.status !== "ACTIVE") {
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

  await prisma.$transaction(async (tx) => {
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

  const limit = query.limit ? Number(query.limit) : 20;
  const page = query.page ? Number(query.page) : 1;
  const skip = (page - 1) * limit;

  const type = query.type as PackageType | undefined;

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
  // 3. BUILD PACKAGE FILTER
  // =====================================================

  const andConditions: Prisma.PackageWhereInput[] = [
    {
      status: PackageStatus.ACTIVE,
    },
    {
      listingStatus: ListingStatus.LISTED,
    },
    {
      branches: {
        some: {
          branchId,
        },
      },
    },
  ];

  if (type) {
    andConditions.push({
      type,
    });
  }

  // =====================================================
  // 4. FETCH BRANCH PACKAGES
  // =====================================================

  const [packages, totalPackageCount] = await Promise.all([
    prisma.package.findMany({
      where: {
        AND: andConditions,
      },

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
      where: {
        AND: andConditions,
      },
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
      // GROUP PURCHASE CAPACITY
      // ===============================================

      const capacity = item.capacity ?? null;

      const remainingQuantity =
        capacity !== null ? Math.max(capacity - item.soldQuantity, 0) : null;

      const soldOut =
        item.type === PackageType.GROUP_PURCHASE_PACKAGE && capacity !== null
          ? item.soldQuantity >= capacity
          : false;

      // ===============================================
      // GROUP PURCHASE AVAILABILITY
      // ===============================================

      const groupPurchaseAvailable =
        item.type === PackageType.GROUP_PURCHASE_PACKAGE
          ? !soldOut &&
            item.salesStartAt !== null &&
            item.salesEndAt !== null &&
            now >= item.salesStartAt &&
            now <= item.salesEndAt
          : null;

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

        type: item.type,

        // =============================================
        // MULTILINGUAL PACKAGE INFORMATION
        // =============================================

        name: localized.name,

        description: localized.description,

        // =============================================
        // NEW PACKAGE DISPLAY FIELDS
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
        // LOCALIZED SERVICES
        // =============================================

        services: item.services.map((serviceItem) => ({
          id: serviceItem.service.id,

          name: localizeName(serviceItem.service, language),
        })),

        // =============================================
        // GROUP PURCHASE INFORMATION
        // =============================================

        ...(item.type === PackageType.GROUP_PURCHASE_PACKAGE && {
          capacity: item.capacity,

          soldQuantity: item.soldQuantity,

          remainingQuantity,

          purchaseLimitPerCustomer: item.purchaseLimitPerCustomer,

          salesStartAt: item.salesStartAt,

          salesEndAt: item.salesEndAt,

          soldOut,

          purchaseAvailable: groupPurchaseAvailable,
        }),
      };
    }),
  );

  // =====================================================
  // 6. PAGINATION
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
