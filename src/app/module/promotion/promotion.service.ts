import { Prisma } from "../../../../generated/prisma/client.js";
import { PromotionStatus, Role } from "../../../../generated/prisma/enums.js";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../utils/app-error.js";
import { DEFAULT_LANGUAGE, Language } from "../../utils/language.js";
import { getLocalizedContent } from "../../utils/localization.js";
import { uploadService } from "../upload/upload.service.js";

import {
  ICreatePromotionPayload,
  IUpdatePromotionPayload,
} from "./promotion.interface.js";

const createPromotion = async (payload: ICreatePromotionPayload) => {
  // =====================================================
  // 1. VALIDATE BRANCH IDS
  // =====================================================

  if (payload.branchIds.length > 0) {
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
  }

  // =====================================================
  // 2. VALIDATE SERVICE IDS
  // =====================================================

  if (payload.serviceIds.length > 0) {
    const services = await prisma.service.findMany({
      where: {
        id: {
          in: payload.serviceIds,
        },
      },

      select: {
        id: true,
      },
    });

    if (services.length !== payload.serviceIds.length) {
      throw new AppError("One or more services were not found", 404);
    }
  }

  // =====================================================
  // 3. VALIDATE PACKAGE IDS
  // =====================================================

  if (payload.packageIds.length > 0) {
    const packages = await prisma.package.findMany({
      where: {
        id: {
          in: payload.packageIds,
        },
      },

      select: {
        id: true,
      },
    });

    if (packages.length !== payload.packageIds.length) {
      throw new AppError("One or more packages were not found", 404);
    }
  }

  // =====================================================
  // 4. PREPARE TRANSLATIONS
  // =====================================================

  const translations = payload.translations
    ? Object.fromEntries(
        Object.entries(payload.translations).filter(
          (entry): entry is [string, { name: string }] =>
            entry[1] !== undefined,
        ),
      )
    : undefined;

  // =====================================================
  // 5. CREATE PROMOTION WITH TRANSLATIONS
  // =====================================================

  const promotion = await prisma.promotion.create({
    data: {
      name: payload.name,

      translations,

      minimumTopup: payload.minimumTopup,

      bonusAmount: payload.bonusAmount,

      startAt: new Date(payload.startAt),

      endAt: new Date(payload.endAt),

      status: payload.status,

      branches:
        payload.branchIds.length > 0
          ? {
              create: payload.branchIds.map((branchId) => ({
                branchId,
              })),
            }
          : undefined,

      services:
        payload.serviceIds.length > 0
          ? {
              create: payload.serviceIds.map((serviceId) => ({
                serviceId,
              })),
            }
          : undefined,

      packages:
        payload.packageIds.length > 0
          ? {
              create: payload.packageIds.map((packageId) => ({
                packageId,
              })),
            }
          : undefined,
    },

    select: {
      id: true,
      name: true,
      translations: true,
      status: true,
    },
  });

  return promotion;
};

// =====================================================
// GET PROMOTIONS
// =====================================================

const getPromotions = async (
  role: Role,
  branchId?: string,
  language: Language = DEFAULT_LANGUAGE,
) => {
  const now = new Date();

  // =====================================================
  // 1. BUILD PROMOTION FILTER
  // =====================================================

  const where: Prisma.PromotionWhereInput = {};

  // CUSTOMER: ONLY ACTIVE + CURRENTLY VALID
  // branchId is optional for customers.
  if (role === Role.CUSTOMER) {
    where.status = PromotionStatus.ACTIVE;

    where.startAt = {
      lte: now,
    };

    where.endAt = {
      gte: now,
    };
  }

  // =====================================================
  // 2. OPTIONAL BRANCH FILTER
  // =====================================================

  // When branchId is provided:
  // - Promotions assigned to the selected branch
  // - Global promotions (no branch assignments)
  //
  // Without branchId:
  // - Keep existing unfiltered listing behavior
  // - Customer active/date filters still apply

  if (branchId) {
    where.OR = [
      {
        branches: {
          some: {
            branchId,
          },
        },
      },
      {
        branches: {
          none: {},
        },
      },
    ];
  }

  // =====================================================
  // 3. FETCH PROMOTIONS
  // =====================================================

  const promotions = await prisma.promotion.findMany({
    where,

    orderBy: {
      createdAt: "desc",
    },

    select: {
      id: true,
      name: true,
      translations: true,

      minimumTopup: true,
      bonusAmount: true,

      startAt: true,
      endAt: true,
      status: true,

      imageObjectKey: true,

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

      packages: {
        select: {
          packageId: true,
        },
      },
    },
  });

  // =====================================================
  // 4. LOCALIZE PROMOTIONS + GENERATE SIGNED IMAGE URLS
  // =====================================================

  const items = await Promise.all(
    promotions.map(async (promotion) => {
      const localizedPromotion = getLocalizedContent(
        promotion.translations,
        language,
        {
          name: promotion.name,
        },
      );

      const imageUrl = promotion.imageObjectKey
        ? await uploadService.getImageUrl(promotion.imageObjectKey)
        : null;

      return {
        id: promotion.id,

        name: localizedPromotion.name,

        minimumTopup: Number(promotion.minimumTopup),
        bonusAmount: Number(promotion.bonusAmount),

        startAt: promotion.startAt.toISOString(),
        endAt: promotion.endAt.toISOString(),

        status: promotion.status,

        imageObjectKey: promotion.imageObjectKey,
        imageUrl,

        branchIds: promotion.branches.map((item) => item.branchId),

        serviceIds: promotion.services.map((item) => item.serviceId),

        packageIds: promotion.packages.map((item) => item.packageId),
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

// =====================================================
// GET SINGLE PROMOTION
// =====================================================

const getPromotionById = async (
  promotionId: string,
  role: Role,
  branchId?: string,
  language: Language = DEFAULT_LANGUAGE,
) => {
  const now = new Date();

  // =====================================================
  // 1. BUILD FILTER
  // =====================================================

  const where: Prisma.PromotionWhereInput = {
    id: promotionId,
  };

  // CUSTOMER: ONLY ACTIVE + CURRENTLY VALID
  // branchId is optional.
  if (role === Role.CUSTOMER) {
    where.status = PromotionStatus.ACTIVE;

    where.startAt = {
      lte: now,
    };

    where.endAt = {
      gte: now,
    };
  }

  // =====================================================
  // 2. OPTIONAL BRANCH FILTER
  // =====================================================

  // Selected branch promotions OR global promotions.
  if (branchId) {
    where.OR = [
      {
        branches: {
          some: {
            branchId,
          },
        },
      },
      {
        branches: {
          none: {},
        },
      },
    ];
  }

  // =====================================================
  // 3. FETCH PROMOTION
  // =====================================================

  const promotion = await prisma.promotion.findFirst({
    where,

    select: {
      id: true,
      name: true,
      translations: true,

      minimumTopup: true,
      bonusAmount: true,

      startAt: true,
      endAt: true,
      status: true,

      imageObjectKey: true,

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

      packages: {
        select: {
          packageId: true,
        },
      },
    },
  });

  // =====================================================
  // 4. CHECK PROMOTION
  // =====================================================

  if (!promotion) {
    throw new AppError("Promotion not found", 404);
  }

  // =====================================================
  // 5. LOCALIZE PROMOTION NAME
  // =====================================================

  const localizedPromotion = getLocalizedContent(
    promotion.translations,
    language,
    {
      name: promotion.name,
    },
  );

  // =====================================================
  // 6. GENERATE SIGNED IMAGE URL
  // =====================================================

  const imageUrl = promotion.imageObjectKey
    ? await uploadService.getImageUrl(promotion.imageObjectKey)
    : null;

  // =====================================================
  // 7. RESPONSE
  // =====================================================

  return {
    id: promotion.id,

    name: localizedPromotion.name,

    minimumTopup: Number(promotion.minimumTopup),
    bonusAmount: Number(promotion.bonusAmount),

    startAt: promotion.startAt.toISOString(),
    endAt: promotion.endAt.toISOString(),

    status: promotion.status,

    imageObjectKey: promotion.imageObjectKey,
    imageUrl,

    branchIds: promotion.branches.map((item) => item.branchId),

    serviceIds: promotion.services.map((item) => item.serviceId),

    packageIds: promotion.packages.map((item) => item.packageId),
  };
};

const updatePromotion = async (
  promotionId: string,
  payload: IUpdatePromotionPayload,
) => {
  // =====================================================
  // 1. FIND PROMOTION
  // =====================================================

  const existingPromotion = await prisma.promotion.findUnique({
    where: {
      id: promotionId,
    },

    select: {
      id: true,
      startAt: true,
      endAt: true,
      imageObjectKey: true,
    },
  });

  if (!existingPromotion) {
    throw new AppError("PROMOTION_NOT_FOUND", 404);
  }

  // =====================================================
  // 2. VALIDATE PROMOTION IMAGE
  // =====================================================

  if (payload.imageObjectKey !== undefined) {
    const expectedPrefix = `promotions/${promotionId}/`;

    if (!payload.imageObjectKey.startsWith(expectedPrefix)) {
      throw new AppError("Invalid promotion image object key", 400);
    }

    await uploadService.verifyImageExists(payload.imageObjectKey);
  }

  // =====================================================
  // 3. VALIDATE FINAL DATE RANGE
  // =====================================================

  const finalStartAt =
    payload.startAt !== undefined
      ? new Date(payload.startAt)
      : existingPromotion.startAt;

  const finalEndAt =
    payload.endAt !== undefined
      ? new Date(payload.endAt)
      : existingPromotion.endAt;

  if (finalStartAt.getTime() >= finalEndAt.getTime()) {
    throw new AppError("endAt must be after startAt", 400);
  }

  // =====================================================
  // 4. VALIDATE BRANCH IDS
  // =====================================================

  if (payload.branchIds !== undefined) {
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
  }

  // =====================================================
  // 5. VALIDATE SERVICE IDS
  // =====================================================

  if (payload.serviceIds !== undefined) {
    const services = await prisma.service.findMany({
      where: {
        id: {
          in: payload.serviceIds,
        },
      },

      select: {
        id: true,
      },
    });

    if (services.length !== payload.serviceIds.length) {
      throw new AppError("One or more services were not found", 404);
    }
  }

  // =====================================================
  // 6. VALIDATE PACKAGE IDS
  // =====================================================

  if (payload.packageIds !== undefined) {
    const packages = await prisma.package.findMany({
      where: {
        id: {
          in: payload.packageIds,
        },
      },

      select: {
        id: true,
      },
    });

    if (packages.length !== payload.packageIds.length) {
      throw new AppError("One or more packages were not found", 404);
    }
  }

  // =====================================================
  // 7. UPDATE ATOMICALLY
  // =====================================================

  const result = await prisma.$transaction(
    async (tx) => {
      // -------------------------------------------------
      // 7.1 MERGE EXISTING TRANSLATIONS
      // -------------------------------------------------

      let translationsUpdate: Record<string, { name: string }> | undefined;

      if (payload.translations !== undefined) {
        const currentPromotion = await tx.promotion.findUniqueOrThrow({
          where: {
            id: promotionId,
          },

          select: {
            translations: true,
          },
        });

        const existingTranslations =
          currentPromotion.translations &&
          typeof currentPromotion.translations === "object" &&
          !Array.isArray(currentPromotion.translations)
            ? currentPromotion.translations
            : {};

        const incomingTranslations = Object.fromEntries(
          Object.entries(payload.translations).filter(
            (entry): entry is [string, { name: string }] =>
              entry[1] !== undefined,
          ),
        );

        translationsUpdate = {
          ...existingTranslations,
          ...incomingTranslations,
        } as Record<string, { name: string }>;
      }

      // -------------------------------------------------
      // 7.2 REMOVE OLD BRANCH ASSOCIATIONS
      // -------------------------------------------------

      if (payload.branchIds !== undefined) {
        await tx.promotionBranch.deleteMany({
          where: {
            promotionId,
          },
        });
      }

      // -------------------------------------------------
      // 7.3 REMOVE OLD SERVICE ASSOCIATIONS
      // -------------------------------------------------

      if (payload.serviceIds !== undefined) {
        await tx.promotionService.deleteMany({
          where: {
            promotionId,
          },
        });
      }

      // -------------------------------------------------
      // 7.4 REMOVE OLD PACKAGE ASSOCIATIONS
      // -------------------------------------------------

      if (payload.packageIds !== undefined) {
        await tx.promotionPackage.deleteMany({
          where: {
            promotionId,
          },
        });
      }

      // -------------------------------------------------
      // 7.5 UPDATE PROMOTION
      // -------------------------------------------------

      return tx.promotion.update({
        where: {
          id: promotionId,
        },

        data: {
          ...(payload.name !== undefined && {
            name: payload.name.trim(),
          }),

          ...(translationsUpdate !== undefined && {
            translations: translationsUpdate,
          }),

          ...(payload.minimumTopup !== undefined && {
            minimumTopup: payload.minimumTopup,
          }),

          ...(payload.bonusAmount !== undefined && {
            bonusAmount: payload.bonusAmount,
          }),

          ...(payload.startAt !== undefined && {
            startAt: new Date(payload.startAt),
          }),

          ...(payload.endAt !== undefined && {
            endAt: new Date(payload.endAt),
          }),

          ...(payload.imageObjectKey !== undefined && {
            imageObjectKey: payload.imageObjectKey,
          }),

          ...(payload.branchIds !== undefined && {
            branches: {
              create: payload.branchIds.map((branchId) => ({
                branchId,
              })),
            },
          }),

          ...(payload.serviceIds !== undefined && {
            services: {
              create: payload.serviceIds.map((serviceId) => ({
                serviceId,
              })),
            },
          }),

          ...(payload.packageIds !== undefined && {
            packages: {
              create: payload.packageIds.map((packageId) => ({
                packageId,
              })),
            },
          }),
        },

        select: {
          id: true,
          name: true,

          translations: true,

          minimumTopup: true,
          bonusAmount: true,
          startAt: true,
          endAt: true,
          status: true,
          imageObjectKey: true,

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

          packages: {
            select: {
              packageId: true,
            },
          },

          createdAt: true,
          updatedAt: true,
        },
      });
    },
    {
      maxWait: 5000,
      timeout: 15000,
    },
  );

  // =====================================================
  // 8. SIGNED IMAGE URL
  // =====================================================

  const imageUrl = result.imageObjectKey
    ? await uploadService.getImageUrl(result.imageObjectKey)
    : null;

  // =====================================================
  // 9. RESPONSE
  // =====================================================

  return {
    id: result.id,

    name: result.name,

    translations: result.translations,

    minimumTopup: Number(result.minimumTopup),

    bonusAmount: Number(result.bonusAmount),

    startAt: result.startAt.toISOString(),

    endAt: result.endAt.toISOString(),

    status: result.status,

    imageObjectKey: result.imageObjectKey,

    imageUrl,

    branchIds: result.branches.map((item) => item.branchId),

    serviceIds: result.services.map((item) => item.serviceId),

    packageIds: result.packages.map((item) => item.packageId),

    createdAt: result.createdAt,

    updatedAt: result.updatedAt,
  };
};

const updatePromotionStatus = async (
  promotionId: string,
  status: PromotionStatus,
) => {
  const promotion = await prisma.promotion.findUnique({
    where: {
      id: promotionId,
    },

    select: {
      id: true,
    },
  });

  if (!promotion) {
    throw new AppError("PROMOTION_NOT_FOUND", 404);
  }

  const result = await prisma.promotion.update({
    where: {
      id: promotionId,
    },

    data: {
      status,
    },

    select: {
      id: true,
      status: true,
    },
  });

  return result;
};

export const promotionService = {
  createPromotion,
  getPromotions,
  getPromotionById,
  updatePromotion,
  updatePromotionStatus,
};
