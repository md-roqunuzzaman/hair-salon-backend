import {
  BranchStatus,
  Prisma,
  ServiceStatus,
} from "../../../../generated/prisma/client.js";

import { prisma } from "../../lib/prisma.js";

import { AppError } from "../../utils/app-error.js";
import { DEFAULT_LANGUAGE, Language } from "../../utils/language.js";
import { getLocalizedContent } from "../../utils/localization.js";
import { auditLogService } from "../auditLog/auditLog.service.js";
import { uploadService } from "../upload/upload.service.js";

import {
  IAssignServiceBranchesPayload,
  ICreateServicePayload,
  IUpdateServicePayload,
  IUpdateServiceStatusPayload,
} from "./service.interface.js";

const createService = async (payload: ICreateServicePayload) => {
  // =====================================================
  // 1. NORMALIZE SERVICE INFORMATION
  // =====================================================

  const serviceName = payload.name.trim();

  const serviceDescription = payload.description?.trim() || null;

  // =====================================================
  // 2. PREPARE SERVICE DISPLAY INFORMATION
  // =====================================================

  const isPopular = payload.isPopular ?? false;

  const processSteps = payload.processSteps ?? [];

  const bookingNotes = payload.bookingNotes ?? [];

  // =====================================================
  // 3. DUPLICATE SERVICE CHECK
  // =====================================================

  const existingService = await prisma.service.findFirst({
    where: {
      name: {
        equals: serviceName,
        mode: "insensitive",
      },
    },
  });

  if (existingService) {
    throw new AppError("Service already exists", 409);
  }

  // =====================================================
  // 4. UNIQUE BRANCH IDS
  // =====================================================

  const uniqueBranchIds = [...new Set(payload.branchIds)];

  if (uniqueBranchIds.length !== payload.branchIds.length) {
    throw new AppError("Duplicate branch IDs are not allowed", 400);
  }

  // =====================================================
  // 5. VALIDATE BRANCHES
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
    throw new AppError("Service cannot be assigned to an inactive branch", 400);
  }

  // =====================================================
  // 6. PREPARE MULTILINGUAL TRANSLATIONS
  // =====================================================

  const translations: Prisma.InputJsonObject = {
    // ===================================================
    // ENGLISH - DEFAULT LANGUAGE
    // ===================================================

    en: {
      name: serviceName,

      description: serviceDescription,

      processSteps,

      bookingNotes,
    },

    // ===================================================
    // SIMPLIFIED CHINESE - zh-CN
    // ===================================================

    ...(payload.translations?.["zh-CN"] && {
      "zh-CN": {
        ...(payload.translations["zh-CN"].name !== undefined && {
          name: payload.translations["zh-CN"].name,
        }),

        ...(payload.translations["zh-CN"].description !== undefined && {
          description: payload.translations["zh-CN"].description,
        }),

        ...(payload.translations["zh-CN"].processSteps !== undefined && {
          processSteps: payload.translations["zh-CN"].processSteps,
        }),

        ...(payload.translations["zh-CN"].bookingNotes !== undefined && {
          bookingNotes: payload.translations["zh-CN"].bookingNotes,
        }),
      },
    }),

    // ===================================================
    // TRADITIONAL CHINESE - zh-HK
    // ===================================================

    ...(payload.translations?.["zh-HK"] && {
      "zh-HK": {
        ...(payload.translations["zh-HK"].name !== undefined && {
          name: payload.translations["zh-HK"].name,
        }),

        ...(payload.translations["zh-HK"].description !== undefined && {
          description: payload.translations["zh-HK"].description,
        }),

        ...(payload.translations["zh-HK"].processSteps !== undefined && {
          processSteps: payload.translations["zh-HK"].processSteps,
        }),

        ...(payload.translations["zh-HK"].bookingNotes !== undefined && {
          bookingNotes: payload.translations["zh-HK"].bookingNotes,
        }),
      },
    }),
  };

  // =====================================================
  // 7. CREATE SERVICE + BRANCH ASSIGNMENTS
  // =====================================================

  const service = await prisma.$transaction(async (tx) => {
    // ===================================================
    // CREATE SERVICE
    // ===================================================

    const createdService = await tx.service.create({
      data: {
        name: serviceName,

        description: serviceDescription,

        price: payload.price,

        durationMinutes: payload.durationMinutes,

        // ===============================================
        // SERVICE DISPLAY INFORMATION
        // ===============================================

        isPopular,

        processSteps,

        bookingNotes,

        // ===============================================
        // MULTILINGUAL SUPPORT
        // ===============================================

        translations,
      },
    });

    // ===================================================
    // ASSIGN SERVICE TO BRANCHES
    // ===================================================

    await tx.serviceBranch.createMany({
      data: uniqueBranchIds.map((branchId) => ({
        serviceId: createdService.id,
        branchId,
      })),
    });

    return createdService;
  });

  // =====================================================
  // 8. FINAL RESPONSE
  // =====================================================

  return {
    id: service.id,

    name: service.name,

    description: service.description,

    price: Number(service.price),

    durationMinutes: service.durationMinutes,

    status: service.status,

    // ===================================================
    // SERVICE DISPLAY INFORMATION
    // ===================================================

    isPopular: service.isPopular,

    processSteps: service.processSteps,

    bookingNotes: service.bookingNotes,

    // ===================================================
    // IMAGES
    // ===================================================

    images: [],

    // ===================================================
    // MULTILINGUAL TRANSLATIONS
    // ===================================================

    translations: service.translations,
  };
};

const getServices = async (
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

  const status = query.status as ServiceStatus | undefined;
  const searchTerm = query.q as string | undefined;

  const andConditions: Prisma.ServiceWhereInput[] = [];

  if (status) {
    andConditions.push({
      status,
    });
  }

  // =====================================================
  // 3. SEARCH
  // =====================================================

  if (searchTerm) {
    andConditions.push({
      OR: [
        {
          name: {
            contains: searchTerm,
            mode: "insensitive",
          },
        },
        {
          description: {
            contains: searchTerm,
            mode: "insensitive",
          },
        },
      ],
    });
  }

  // =====================================================
  // 4. FETCH SERVICES + TOTAL COUNT
  // =====================================================

  const [services, totalServiceCount] = await Promise.all([
    prisma.service.findMany({
      where: {
        AND: andConditions,
      },

      take: limit,
      skip,

      orderBy: {
        createdAt: "desc",
      },

      include: {
        images: {
          where: {
            isPrimary: true,
          },

          take: 1,

          select: {
            objectKey: true,
          },
        },

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

    prisma.service.count({
      where: {
        AND: andConditions,
      },
    }),
  ]);

  // =====================================================
  // 5. LOCALIZE SERVICES + GENERATE IMAGE URLS
  // =====================================================

  const items = await Promise.all(
    services.map(async (service) => {
      // ===============================================
      // LOCALIZE SERVICE INFORMATION
      // ===============================================

      const localizedService = getLocalizedContent(
        service.translations,
        language,
        {
          name: service.name,
          description: service.description,
          processSteps: service.processSteps,
          bookingNotes: service.bookingNotes,
        },
      );

      // ===============================================
      // GENERATE PRIMARY IMAGE URL
      // ===============================================

      const primaryImageObjectKey = service.images[0]?.objectKey ?? null;

      const primaryImageUrl = primaryImageObjectKey
        ? await uploadService.getImageUrl(primaryImageObjectKey)
        : null;

      // ===============================================
      // LOCALIZE BRANCH NAMES
      // ===============================================

      const localizedBranches = service.branches.map((item) => {
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
      });

      // ===============================================
      // FINAL SERVICE RESPONSE
      // ===============================================

      return {
        id: service.id,

        name: localizedService.name,

        description: localizedService.description,

        price: Number(service.price),

        durationMinutes: service.durationMinutes,

        status: service.status,

        // =============================================
        // SERVICE DISPLAY INFORMATION
        // =============================================

        isPopular: service.isPopular,

        processSteps: localizedService.processSteps,

        bookingNotes: localizedService.bookingNotes,

        // =============================================
        // PRIMARY IMAGE
        // =============================================

        primaryImage: primaryImageObjectKey
          ? {
              objectKey: primaryImageObjectKey,
              url: primaryImageUrl,
            }
          : null,

        // =============================================
        // BRANCHES
        // =============================================

        branches: localizedBranches,
      };
    }),
  );

  // =====================================================
  // 6. PAGINATION
  // =====================================================

  const totalPages = Math.ceil(totalServiceCount / limit);

  // =====================================================
  // 7. FINAL RESPONSE
  // =====================================================

  return {
    items,

    pagination: {
      page,
      limit,
      total: totalServiceCount,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    },
  };
};

const getServiceById = async (
  serviceId: string,
  language: Language = DEFAULT_LANGUAGE,
) => {
  // =====================================================
  // 1. FIND SERVICE
  // =====================================================

  const service = await prisma.service.findUnique({
    where: {
      id: serviceId,
    },

    include: {
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

      branches: {
        select: {
          branch: {
            select: {
              id: true,
              name: true,
              status: true,
              translations: true,
            },
          },
        },
      },
    },
  });

  if (!service) {
    throw new AppError("Service not found", 404);
  }

  // =====================================================
  // 2. LOCALIZE SERVICE INFORMATION
  // =====================================================

  const localizedService = getLocalizedContent(service.translations, language, {
    name: service.name,

    description: service.description,

    processSteps: service.processSteps,

    bookingNotes: service.bookingNotes,
  });

  // =====================================================
  // 3. GENERATE CLOUDFLARE R2 SIGNED IMAGE URLS
  // =====================================================

  const images = await Promise.all(
    service.images.map(async (image) => ({
      id: image.id,

      objectKey: image.objectKey,

      url: await uploadService.getImageUrl(image.objectKey),

      isPrimary: image.isPrimary,

      sortOrder: image.sortOrder,
    })),
  );

  // =====================================================
  // 4. LOCALIZE BRANCHES
  // =====================================================

  const branches = service.branches.map((item) => {
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
  // 5. FINAL RESPONSE
  // =====================================================

  return {
    id: service.id,

    // ===================================================
    // LOCALIZED SERVICE INFORMATION
    // ===================================================

    name: localizedService.name,

    description: localizedService.description,

    // ===================================================
    // PRICING + DURATION
    // ===================================================

    price: Number(service.price),

    durationMinutes: service.durationMinutes,

    status: service.status,

    // ===================================================
    // SERVICE DISPLAY INFORMATION
    // ===================================================

    isPopular: service.isPopular,

    processSteps: localizedService.processSteps,

    bookingNotes: localizedService.bookingNotes,

    // ===================================================
    // IMAGES
    // ===================================================

    images,

    // ===================================================
    // ASSIGNED BRANCHES
    // ===================================================

    branches,
  };
};

const getServiceTranslationRecord = (
  value: unknown,
): Record<string, Record<string, unknown>> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }

  const result: Record<string, Record<string, unknown>> = {};

  for (const locale of ["en", "zh-CN", "zh-HK"]) {
    const entry = (value as Record<string, unknown>)[locale];

    if (typeof entry === "object" && entry !== null && !Array.isArray(entry)) {
      result[locale] = { ...entry };
    }
  }

  return result;
};

const updateService = async (
  serviceId: string,
  payload: IUpdateServicePayload,
) => {
  // =====================================================
  // 1. FIND SERVICE
  // =====================================================

  const service = await prisma.service.findUnique({
    where: {
      id: serviceId,
    },
  });

  if (!service) {
    throw new AppError("Service not found", 404);
  }

  // =====================================================
  // 2. CHECK DUPLICATE SERVICE NAME
  // =====================================================

  if (payload.name !== undefined) {
    const serviceName = payload.name.trim();

    const existingService = await prisma.service.findFirst({
      where: {
        name: {
          equals: serviceName,
          mode: "insensitive",
        },

        NOT: {
          id: serviceId,
        },
      },
    });

    if (existingService) {
      throw new AppError("Service already exists", 409);
    }
  }

  // =====================================================
  // 3. IMAGE VALIDATION
  // =====================================================

  let uniqueImageObjectKeys: string[] | undefined;

  if (payload.imageObjectKeys !== undefined) {
    uniqueImageObjectKeys = [...new Set(payload.imageObjectKeys)];

    if (uniqueImageObjectKeys.length !== payload.imageObjectKeys.length) {
      throw new AppError("Duplicate service images are not allowed", 400);
    }

    const expectedPrefix = `services/${serviceId}/`;

    const invalidImage = uniqueImageObjectKeys.find(
      (objectKey) => !objectKey.startsWith(expectedPrefix),
    );

    if (invalidImage) {
      throw new AppError("Invalid service image object key", 400);
    }

    // =====================================================
    // 4. VERIFY IMAGES EXIST IN CLOUDFLARE R2
    // =====================================================

    await Promise.all(
      uniqueImageObjectKeys.map((objectKey) =>
        uploadService.verifyImageExists(objectKey),
      ),
    );
  }

  // =====================================================
  // 5. UPDATE SERVICE + IMAGES TRANSACTIONALLY
  // =====================================================

  const updatedService = await prisma.$transaction(async (tx) => {
    // Fetch latest service state for translation merging.

    const currentService = await tx.service.findUnique({
      where: {
        id: serviceId,
      },
    });

    if (!currentService) {
      throw new AppError("Service not found", 404);
    }

    // ===================================================
    // PREPARE MULTILINGUAL TRANSLATIONS
    // ===================================================

    const shouldUpdateTranslations =
      payload.translations !== undefined ||
      payload.name !== undefined ||
      payload.description !== undefined ||
      payload.processSteps !== undefined ||
      payload.bookingNotes !== undefined;

    let mergedTranslations: Prisma.InputJsonObject | undefined;

    if (shouldUpdateTranslations) {
      const existingTranslations = getServiceTranslationRecord(
        currentService.translations,
      );

      const incomingTranslations = payload.translations;

      const nextTranslations = {
        ...existingTranslations,
      };

      // ===================================================
      // MERGE SIMPLIFIED + TRADITIONAL CHINESE
      // ===================================================

      for (const locale of ["zh-CN", "zh-HK"] as const) {
        const incoming = incomingTranslations?.[locale];

        if (incoming !== undefined) {
          nextTranslations[locale] = {
            ...(nextTranslations[locale] ?? {}),

            ...(incoming.name !== undefined && {
              name: incoming.name,
            }),

            ...(incoming.description !== undefined && {
              description: incoming.description,
            }),

            ...(incoming.processSteps !== undefined && {
              processSteps: incoming.processSteps,
            }),

            ...(incoming.bookingNotes !== undefined && {
              bookingNotes: incoming.bookingNotes,
            }),
          };
        }
      }

      // ===================================================
      // ENGLISH BASE FIELDS REMAIN SOURCE OF TRUTH
      // ===================================================

      nextTranslations.en = {
        ...(nextTranslations.en ?? {}),

        name:
          payload.name !== undefined
            ? payload.name.trim()
            : currentService.name,

        description:
          payload.description !== undefined
            ? payload.description.trim()
            : currentService.description,

        processSteps:
          payload.processSteps !== undefined
            ? payload.processSteps
            : currentService.processSteps,

        bookingNotes:
          payload.bookingNotes !== undefined
            ? payload.bookingNotes
            : currentService.bookingNotes,
      };

      mergedTranslations = nextTranslations as Prisma.InputJsonObject;
    }

    // ===================================================
    // UPDATE SERVICE
    // ===================================================

    await tx.service.update({
      where: {
        id: serviceId,
      },

      data: {
        ...(payload.name !== undefined && {
          name: payload.name.trim(),
        }),

        ...(payload.description !== undefined && {
          description: payload.description.trim(),
        }),

        ...(payload.price !== undefined && {
          price: payload.price,
        }),

        ...(payload.durationMinutes !== undefined && {
          durationMinutes: payload.durationMinutes,
        }),

        // ===============================================
        // SERVICE DISPLAY INFORMATION
        // ===============================================

        ...(payload.isPopular !== undefined && {
          isPopular: payload.isPopular,
        }),

        ...(payload.processSteps !== undefined && {
          processSteps: payload.processSteps,
        }),

        ...(payload.bookingNotes !== undefined && {
          bookingNotes: payload.bookingNotes,
        }),

        // ===============================================
        // MULTILINGUAL TRANSLATIONS
        // ===============================================

        ...(mergedTranslations !== undefined && {
          translations: mergedTranslations,
        }),
      },
    });

    // ===================================================
    // REPLACE IMAGES ONLY WHEN PROVIDED
    // ===================================================

    if (uniqueImageObjectKeys !== undefined) {
      await tx.serviceImage.deleteMany({
        where: {
          serviceId,
        },
      });

      if (uniqueImageObjectKeys.length > 0) {
        await tx.serviceImage.createMany({
          data: uniqueImageObjectKeys.map((objectKey, index) => ({
            serviceId,
            objectKey,
            isPrimary: index === 0,
            sortOrder: index,
          })),
        });
      }
    }

    // ===================================================
    // FETCH UPDATED SERVICE
    // ===================================================

    return tx.service.findUnique({
      where: {
        id: serviceId,
      },

      include: {
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

        branches: {
          select: {
            branch: {
              select: {
                id: true,
                name: true,
                status: true,
              },
            },
          },
        },
      },
    });
  });

  // =====================================================
  // 6. SAFETY CHECK
  // =====================================================

  if (!updatedService) {
    throw new AppError("Service not found after update", 404);
  }

  // =====================================================
  // 7. GENERATE CLOUDFLARE R2 SIGNED IMAGE URLS
  // =====================================================

  const images = await Promise.all(
    updatedService.images.map(async (image) => ({
      id: image.id,
      objectKey: image.objectKey,
      url: await uploadService.getImageUrl(image.objectKey),
      isPrimary: image.isPrimary,
      sortOrder: image.sortOrder,
    })),
  );

  // =====================================================
  // 8. FINAL RESPONSE
  // =====================================================

  return {
    id: updatedService.id,

    name: updatedService.name,

    description: updatedService.description,

    price: Number(updatedService.price),

    durationMinutes: updatedService.durationMinutes,

    status: updatedService.status,

    // ===================================================
    // SERVICE DISPLAY INFORMATION
    // ===================================================

    isPopular: updatedService.isPopular,

    processSteps: updatedService.processSteps,

    bookingNotes: updatedService.bookingNotes,

    // ===================================================
    // IMAGES
    // ===================================================

    images,

    // ===================================================
    // BRANCHES
    // ===================================================

    branches: updatedService.branches.map((item) => ({
      id: item.branch.id,
      name: item.branch.name,
      status: item.branch.status,
    })),

    // ===================================================
    // MULTILINGUAL TRANSLATIONS
    // ===================================================

    translations: updatedService.translations,
  };
};

const updateServiceStatus = async (
  serviceId: string,
  payload: IUpdateServiceStatusPayload,
  userId: string,
) => {
  const service = await prisma.service.findUnique({
    where: {
      id: serviceId,
    },
  });

  if (!service) {
    throw new AppError("Service not found", 404);
  }

  // =====================================================
  // SAME STATUS — NO UPDATE / NO AUDIT
  // =====================================================

  if (service.status === payload.status) {
    return {
      id: service.id,
      status: service.status,
    };
  }

  // =====================================================
  // UPDATE + AUDIT
  // =====================================================

  const updatedService = await prisma.$transaction(async (tx) => {
    const result = await tx.service.update({
      where: {
        id: serviceId,
      },

      data: {
        status: payload.status,
      },
    });

    await auditLogService.createAuditLog(
      {
        userId,

        action: "SERVICE_STATUS_CHANGED",

        entityType: "SERVICE",

        entityId: serviceId,

        metadata: {
          previousStatus: service.status,
          newStatus: result.status,
        },
      },

      tx,
    );

    return result;
  });

  return {
    id: updatedService.id,
    status: updatedService.status,
  };
};

const assignServiceToBranches = async (
  serviceId: string,
  payload: IAssignServiceBranchesPayload,
) => {
  const service = await prisma.service.findUnique({
    where: {
      id: serviceId,
    },
  });

  if (!service) {
    throw new AppError("Service not found", 404);
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
    throw new AppError("Service cannot be assigned to an inactive branch", 400);
  }

  await prisma.$transaction(async (tx) => {
    await tx.serviceBranch.deleteMany({
      where: {
        serviceId,
      },
    });

    await tx.serviceBranch.createMany({
      data: uniqueBranchIds.map((branchId) => ({
        serviceId,
        branchId,
      })),
    });
  });

  return {
    serviceId,
    branchIds: uniqueBranchIds,
  };
};

const getBranchServices = async (
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

  // =====================================================
  // 2. CHECK BRANCH
  // =====================================================

  const branch = await prisma.branch.findUnique({
    where: {
      id: branchId,
    },
  });

  if (!branch) {
    throw new AppError("Branch not found", 404);
  }

  if (branch.status !== BranchStatus.ACTIVE) {
    throw new AppError("Branch is inactive", 400);
  }

  // =====================================================
  // 3. STATUS
  // =====================================================

  const status = query.status
    ? (query.status as ServiceStatus)
    : ServiceStatus.ACTIVE;

  // =====================================================
  // 4. FETCH SERVICES + COUNT
  // =====================================================

  const [services, totalServiceCount] = await Promise.all([
    prisma.service.findMany({
      where: {
        status,

        branches: {
          some: {
            branchId,
          },
        },
      },

      take: limit,
      skip,

      orderBy: {
        createdAt: "desc",
      },

      include: {
        images: {
          where: {
            isPrimary: true,
          },

          take: 1,

          select: {
            objectKey: true,
          },
        },
      },
    }),

    prisma.service.count({
      where: {
        status,

        branches: {
          some: {
            branchId,
          },
        },
      },
    }),
  ]);

  // =====================================================
  // 5. LOCALIZE SERVICES + GENERATE IMAGE URLS
  // =====================================================

  const items = await Promise.all(
    services.map(async (service) => {
      // ===============================================
      // LOCALIZE SERVICE INFORMATION
      // ===============================================

      const localizedService = getLocalizedContent(
        service.translations,
        language,
        {
          name: service.name,

          description: service.description,

          processSteps: service.processSteps,

          bookingNotes: service.bookingNotes,
        },
      );

      // ===============================================
      // GENERATE PRIMARY IMAGE URL
      // ===============================================

      const primaryImageObjectKey = service.images[0]?.objectKey ?? null;

      const primaryImageUrl = primaryImageObjectKey
        ? await uploadService.getImageUrl(primaryImageObjectKey)
        : null;

      // ===============================================
      // FINAL SERVICE RESPONSE
      // ===============================================

      return {
        id: service.id,

        // =============================================
        // LOCALIZED INFORMATION
        // =============================================

        name: localizedService.name,

        description: localizedService.description,

        // =============================================
        // PRICE + DURATION
        // =============================================

        price: Number(service.price),

        durationMinutes: service.durationMinutes,

        // =============================================
        // SERVICE DISPLAY INFORMATION
        // =============================================

        isPopular: service.isPopular,

        processSteps: localizedService.processSteps,

        bookingNotes: localizedService.bookingNotes,

        // =============================================
        // PRIMARY IMAGE
        // =============================================

        primaryImage: primaryImageObjectKey
          ? {
              objectKey: primaryImageObjectKey,
              url: primaryImageUrl,
            }
          : null,
      };
    }),
  );

  // =====================================================
  // 6. PAGINATION
  // =====================================================

  const totalPages = Math.ceil(totalServiceCount / limit);

  // =====================================================
  // 7. FINAL RESPONSE
  // =====================================================

  return {
    items,

    pagination: {
      page,
      limit,
      total: totalServiceCount,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    },
  };
};

export const serviceService = {
  createService,
  getServices,
  getServiceById,
  updateService,
  updateServiceStatus,
  assignServiceToBranches,
  getBranchServices,
};
