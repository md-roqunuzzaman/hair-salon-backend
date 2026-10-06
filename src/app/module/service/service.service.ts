import {
  BranchStatus,
  Prisma,
  ServiceStatus,
} from "../../../../generated/prisma/client.js";

import { prisma } from "../../lib/prisma.js";

import { AppError } from "../../utils/app-error.js";
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
  // 1. NORMALIZE SERVICE NAME
  // =====================================================

  const serviceName = payload.name.trim();

  // =====================================================
  // 2. DUPLICATE SERVICE CHECK
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
  // 3. UNIQUE BRANCH IDS
  // =====================================================

  const uniqueBranchIds = [...new Set(payload.branchIds)];

  if (uniqueBranchIds.length !== payload.branchIds.length) {
    throw new AppError("Duplicate branch IDs are not allowed", 400);
  }

  // =====================================================
  // 4. VALIDATE BRANCHES
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

  const inactiveBranch = branches.find((branch) => branch.status !== "ACTIVE");

  if (inactiveBranch) {
    throw new AppError("Service cannot be assigned to an inactive branch", 400);
  }

  // =====================================================
  // 5. CREATE SERVICE + BRANCH ASSIGNMENTS
  // =====================================================

  const service = await prisma.$transaction(async (tx) => {
    const createdService = await tx.service.create({
      data: {
        name: serviceName,

        description: payload.description?.trim() || null,

        price: payload.price,

        durationMinutes: payload.durationMinutes,
      },
    });

    // ===============================================
    // ASSIGN SERVICE TO BRANCHES
    // ===============================================

    await tx.serviceBranch.createMany({
      data: uniqueBranchIds.map((branchId) => ({
        serviceId: createdService.id,

        branchId,
      })),
    });

    return createdService;
  });

  // =====================================================
  // 6. RESPONSE
  // =====================================================

  return {
    id: service.id,

    name: service.name,

    description: service.description,

    price: Number(service.price),

    durationMinutes: service.durationMinutes,

    status: service.status,

    images: [],
  };
};

const getServices = async (query: Record<string, any>) => {
  const limit = query.limit ? Number(query.limit) : 20;
  const page = query.page ? Number(query.page) : 1;
  const skip = (page - 1) * limit;

  const status = query.status as ServiceStatus | undefined;
  const searchTerm = query.q as string | undefined;

  const andConditions: Prisma.ServiceWhereInput[] = [];

  if (status) {
    andConditions.push({
      status,
    });
  }

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

  const items = await Promise.all(
    services.map(async (service) => {
      const primaryImageObjectKey = service.images[0]?.objectKey ?? null;

      const primaryImageUrl = primaryImageObjectKey
        ? await uploadService.getImageUrl(primaryImageObjectKey)
        : null;

      return {
        id: service.id,

        name: service.name,

        description: service.description,

        price: Number(service.price),

        durationMinutes: service.durationMinutes,

        status: service.status,

        primaryImage: primaryImageObjectKey
          ? {
              objectKey: primaryImageObjectKey,
              url: primaryImageUrl,
            }
          : null,

        branches: service.branches.map((item) => ({
          id: item.branch.id,
          name: item.branch.name,
        })),
      };
    }),
  );

  const totalPages = Math.ceil(totalServiceCount / limit);

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
const getServiceById = async (serviceId: string) => {
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
  // 2. GENERATE SIGNED IMAGE URLS
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
  // 3. RESPONSE
  // =====================================================

  return {
    id: service.id,

    name: service.name,

    description: service.description,

    price: Number(service.price),

    durationMinutes: service.durationMinutes,

    status: service.status,

    images,

    branches: service.branches.map((item) => ({
      id: item.branch.id,

      name: item.branch.name,

      status: item.branch.status,
    })),
  };
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

    include: {
      images: true,
    },
  });

  if (!service) {
    throw new AppError("Service not found", 404);
  }

  // =====================================================
  // 2. CHECK DUPLICATE SERVICE NAME
  // =====================================================

  if (payload.name) {
    const existingService = await prisma.service.findFirst({
      where: {
        name: {
          equals: payload.name.trim(),
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

    // ===================================================
    // 4. VERIFY IMAGES ACTUALLY EXIST IN R2
    // ===================================================

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
      },
    });

    // ================================================
    // REPLACE SERVICE IMAGES
    // ================================================

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

    // ================================================
    // RETURN UPDATED SERVICE WITH IMAGES
    // ================================================

    return await tx.service.findUnique({
      where: {
        id: serviceId,
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

  // =====================================================
  // 6. SAFETY CHECK
  // =====================================================

  if (!updatedService) {
    throw new AppError("Service not found after update", 404);
  }

  // =====================================================
  // 7. RESPONSE
  // =====================================================

  return {
    id: updatedService.id,

    name: updatedService.name,

    description: updatedService.description,

    price: Number(updatedService.price),

    durationMinutes: updatedService.durationMinutes,

    status: updatedService.status,

    images: updatedService.images.map((image) => ({
      objectKey: image.objectKey,

      isPrimary: image.isPrimary,

      sortOrder: image.sortOrder,
    })),
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
) => {
  const limit = query.limit ? Number(query.limit) : 20;
  const page = query.page ? Number(query.page) : 1;
  const skip = (page - 1) * limit;

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

  if (branch.status !== BranchStatus.ACTIVE) {
    throw new AppError("Branch is inactive", 400);
  }

  // =====================================================
  // 2. STATUS
  // =====================================================

  const status = query.status
    ? (query.status as ServiceStatus)
    : ServiceStatus.ACTIVE;

  // =====================================================
  // 3. FETCH SERVICES + COUNT
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
  // 4. GENERATE PRIMARY IMAGE URL
  // =====================================================

  const items = await Promise.all(
    services.map(async (service) => {
      const primaryImageObjectKey = service.images[0]?.objectKey ?? null;

      const primaryImageUrl = primaryImageObjectKey
        ? await uploadService.getImageUrl(primaryImageObjectKey)
        : null;

      return {
        id: service.id,

        name: service.name,

        price: Number(service.price),

        durationMinutes: service.durationMinutes,

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
  // 5. PAGINATION
  // =====================================================

  const totalPages = Math.ceil(totalServiceCount / limit);

  // =====================================================
  // 6. RESPONSE
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
