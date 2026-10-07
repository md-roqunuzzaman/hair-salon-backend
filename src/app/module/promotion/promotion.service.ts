import { PromotionStatus, Role } from "../../../../generated/prisma/enums.js";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../utils/app-error.js";
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
  // 4. CREATE PROMOTION
  // =====================================================

  const promotion = await prisma.promotion.create({
    data: {
      name: payload.name,

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
      status: true,
    },
  });

  return promotion;
};

const getPromotions = async (role: Role) => {
  const now = new Date();

  const promotions = await prisma.promotion.findMany({
    where:
      role === Role.CUSTOMER
        ? {
            status: PromotionStatus.ACTIVE,

            startAt: {
              lte: now,
            },

            endAt: {
              gte: now,
            },
          }
        : undefined,

    orderBy: {
      createdAt: "desc",
    },

    select: {
      id: true,
      name: true,
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

  const items = await Promise.all(
    promotions.map(async (promotion) => {
      const imageUrl = promotion.imageObjectKey
        ? await uploadService.getImageUrl(promotion.imageObjectKey)
        : null;

      return {
        id: promotion.id,

        name: promotion.name,

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

  return {
    items,
  };
};

const getPromotionById = async (promotionId: string) => {
  const promotion = await prisma.promotion.findUnique({
    where: {
      id: promotionId,
    },

    select: {
      id: true,

      name: true,

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

  if (!promotion) {
    throw new AppError("PROMOTION_NOT_FOUND", 404);
  }

  // =====================================================
  // SIGNED PROMOTION IMAGE URL
  // =====================================================

  const imageUrl = promotion.imageObjectKey
    ? await uploadService.getImageUrl(promotion.imageObjectKey)
    : null;

  // =====================================================
  // RESPONSE
  // =====================================================

  return {
    id: promotion.id,

    name: promotion.name,

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

    createdAt: promotion.createdAt,

    updatedAt: promotion.updatedAt,
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
      if (payload.branchIds !== undefined) {
        await tx.promotionBranch.deleteMany({
          where: {
            promotionId,
          },
        });
      }

      if (payload.serviceIds !== undefined) {
        await tx.promotionService.deleteMany({
          where: {
            promotionId,
          },
        });
      }

      if (payload.packageIds !== undefined) {
        await tx.promotionPackage.deleteMany({
          where: {
            promotionId,
          },
        });
      }

      return tx.promotion.update({
        where: {
          id: promotionId,
        },

        data: {
          ...(payload.name !== undefined && {
            name: payload.name.trim(),
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
