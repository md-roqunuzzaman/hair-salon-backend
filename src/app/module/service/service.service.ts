import {
  BranchStatus,
  Prisma,
  ServiceStatus,
} from "../../../../generated/prisma/client.js";

import { prisma } from "../../lib/prisma.js";

import { AppError } from "../../utils/app-error.js";

import {
  IAssignServiceBranchesPayload,
  ICreateServicePayload,
  IUpdateServicePayload,
  IUpdateServiceStatusPayload,
} from "./service.interface.js";

const createService = async (payload: ICreateServicePayload) => {
  const serviceName = payload.name.trim();

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

  const uniqueBranchIds = [...new Set(payload.branchIds)];

  if (uniqueBranchIds.length !== payload.branchIds.length) {
    throw new AppError("Duplicate branch IDs are not allowed", 400);
  }

  const uniqueImageObjectKeys = [...new Set(payload.imageObjectKeys)];

  if (uniqueImageObjectKeys.length !== payload.imageObjectKeys.length) {
    throw new AppError("Duplicate service images are not allowed", 400);
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

  const service = await prisma.$transaction(async (tx) => {
    const createdService = await tx.service.create({
      data: {
        name: serviceName,
        description: payload.description?.trim() || null,
        price: payload.price,
        durationMinutes: payload.durationMinutes,
      },
    });

    await tx.serviceImage.createMany({
      data: uniqueImageObjectKeys.map((objectKey, index) => ({
        serviceId: createdService.id,
        objectKey,
        isPrimary: index === 0,
        sortOrder: index,
      })),
    });

    await tx.serviceBranch.createMany({
      data: uniqueBranchIds.map((branchId) => ({
        serviceId: createdService.id,
        branchId,
      })),
    });

    return createdService;
  });

  return {
    id: service.id,
    name: service.name,
    price: Number(service.price),
    durationMinutes: service.durationMinutes,
    status: service.status,
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

  const services = await prisma.service.findMany({
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
  });

  const totalServiceCount = await prisma.service.count({
    where: {
      AND: andConditions,
    },
  });

  return {
    items: services.map((service) => ({
      id: service.id,
      name: service.name,
      description: service.description,
      price: Number(service.price),
      durationMinutes: service.durationMinutes,
      status: service.status,

      primaryImageObjectKey: service.images[0]?.objectKey || null,

      branches: service.branches.map((item) => ({
        id: item.branch.id,
        name: item.branch.name,
      })),
    })),

    pagination: {
      page,
      limit,
      total: totalServiceCount,
      totalPages: Math.ceil(totalServiceCount / limit),
      hasNextPage: page < Math.ceil(totalServiceCount / limit),
      hasPreviousPage: page > 1,
    },
  };
};

const getServiceById = async (serviceId: string) => {
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

  return {
    id: service.id,
    name: service.name,
    description: service.description,
    price: Number(service.price),
    durationMinutes: service.durationMinutes,
    status: service.status,

    images: service.images.map((image) => ({
      id: image.id,
      objectKey: image.objectKey,
      isPrimary: image.isPrimary,
      sortOrder: image.sortOrder,
    })),

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
  const service = await prisma.service.findUnique({
    where: {
      id: serviceId,
    },
  });

  if (!service) {
    throw new AppError("Service not found", 404);
  }

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

  const updatedService = await prisma.service.update({
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

  return {
    id: updatedService.id,
    name: updatedService.name,
    price: Number(updatedService.price),
    durationMinutes: updatedService.durationMinutes,
  };
};

const updateServiceStatus = async (
  serviceId: string,
  payload: IUpdateServiceStatusPayload,
) => {
  const service = await prisma.service.findUnique({
    where: {
      id: serviceId,
    },
  });

  if (!service) {
    throw new AppError("Service not found", 404);
  }

  const updatedService = await prisma.service.update({
    where: {
      id: serviceId,
    },

    data: {
      status: payload.status,
    },
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

  const status = query.status
    ? (query.status as ServiceStatus)
    : ServiceStatus.ACTIVE;

  const services = await prisma.service.findMany({
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
  });

  const totalServiceCount = await prisma.service.count({
    where: {
      status,

      branches: {
        some: {
          branchId,
        },
      },
    },
  });

  return {
    items: services.map((service) => ({
      id: service.id,
      name: service.name,
      price: Number(service.price),
      durationMinutes: service.durationMinutes,

      primaryImageObjectKey: service.images[0]?.objectKey || null,
    })),

    pagination: {
      page,
      limit,
      total: totalServiceCount,
      totalPages: Math.ceil(totalServiceCount / limit),
      hasNextPage: page < Math.ceil(totalServiceCount / limit),
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
