import {
  BranchStatus,
  ListingStatus,
  PackageStatus,
  PackageType,
  Prisma,
  ServiceStatus,
} from "../../../../generated/prisma/client.js";

import { prisma } from "../../lib/prisma.js";

import { AppError } from "../../utils/app-error.js";

import {
  IAssignPackageBranchesPayload,
  ICreatePackagePayload,
  IUpdatePackageListingPayload,
  IUpdatePackagePayload,
  IUpdatePackageStatusPayload,
} from "./package.interface.js";

const createPackage = async (payload: ICreatePackagePayload) => {
  const packageName = payload.name.trim();

  // 1. Duplicate package name check
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

  // 2. Duplicate service IDs check
  const uniqueServiceIds = [...new Set(payload.serviceIds)];

  if (uniqueServiceIds.length !== payload.serviceIds.length) {
    throw new AppError("Duplicate service IDs are not allowed", 400);
  }

  // 3. Duplicate branch IDs check
  const uniqueBranchIds = [...new Set(payload.branchIds)];

  if (uniqueBranchIds.length !== payload.branchIds.length) {
    throw new AppError("Duplicate branch IDs are not allowed", 400);
  }

  // 4. Duplicate image keys check
  const uniqueImageObjectKeys = [...new Set(payload.imageObjectKeys)];

  if (uniqueImageObjectKeys.length !== payload.imageObjectKeys.length) {
    throw new AppError("Duplicate package images are not allowed", 400);
  }

  // 5. Check all services exist
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

  // 6. All included services must be ACTIVE
  const inactiveService = services.find(
    (service) => service.status !== ServiceStatus.ACTIVE,
  );

  if (inactiveService) {
    throw new AppError(
      "Inactive services cannot be included in a package",
      400,
    );
  }

  // 7. Check all branches exist
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

  // 8. All assigned branches must be ACTIVE
  const inactiveBranch = branches.find(
    (branch) => branch.status !== BranchStatus.ACTIVE,
  );

  if (inactiveBranch) {
    throw new AppError("Package cannot be assigned to an inactive branch", 400);
  }

  // 9. Every included service must be available
  // in every branch assigned to this package
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

  // 10. Extra safety for prices
  if (payload.packagePrice > payload.regularPrice) {
    throw new AppError(
      "Package price cannot be greater than regular price",
      400,
    );
  }

  // 11. Group Purchase specific rules
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

  // 12. Create everything atomically
  const createdPackage = await prisma.$transaction(async (tx) => {
    const packageData = await tx.package.create({
      data: {
        type: payload.type,
        name: packageName,

        description: payload.description?.trim() || null,

        regularPrice: payload.regularPrice,
        packagePrice: payload.packagePrice,
        durationMinutes: payload.durationMinutes,

        listingStatus: payload.listingStatus,

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

    await tx.packageService.createMany({
      data: uniqueServiceIds.map((serviceId) => ({
        packageId: packageData.id,
        serviceId,
      })),
    });

    await tx.packageBranch.createMany({
      data: uniqueBranchIds.map((branchId) => ({
        packageId: packageData.id,
        branchId,
      })),
    });

    await tx.packageImage.createMany({
      data: uniqueImageObjectKeys.map((objectKey, index) => ({
        packageId: packageData.id,
        objectKey,
        isPrimary: index === 0,
        sortOrder: index,
      })),
    });

    return packageData;
  });

  // 13. Standard Package response
  if (createdPackage.type === PackageType.STANDARD_SERVICE_PACKAGE) {
    return {
      id: createdPackage.id,
      type: createdPackage.type,
      name: createdPackage.name,
      packagePrice: Number(createdPackage.packagePrice),
      durationMinutes: createdPackage.durationMinutes,
      status: createdPackage.status,
      listingStatus: createdPackage.listingStatus,
    };
  }

  // 14. Group Purchase response
  const capacity = createdPackage.capacity ?? 0;

  const remainingQuantity = capacity - createdPackage.soldQuantity;

  return {
    id: createdPackage.id,
    type: createdPackage.type,
    capacity,
    soldQuantity: createdPackage.soldQuantity,
    remainingQuantity,
    status: createdPackage.status,
    listingStatus: createdPackage.listingStatus,
    soldOut: remainingQuantity <= 0,
  };
};

const getPackages = async (query: Record<string, any>) => {
  const limit = query.limit ? Number(query.limit) : 20;
  const page = query.page ? Number(query.page) : 1;
  const skip = (page - 1) * limit;

  const type = query.type as PackageType | undefined;
  const status = query.status as PackageStatus | undefined;
  const listingStatus = query.listingStatus as ListingStatus | undefined;

  const andConditions: Prisma.PackageWhereInput[] = [];

  if (type) {
    andConditions.push({
      type,
    });
  }

  if (status) {
    andConditions.push({
      status,
    });
  }

  if (listingStatus) {
    andConditions.push({
      listingStatus,
    });
  }

  const packages = await prisma.package.findMany({
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

      services: {
        select: {
          service: {
            select: {
              id: true,
              name: true,
            },
          },
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

  const totalPackageCount = await prisma.package.count({
    where: {
      AND: andConditions,
    },
  });

  return {
    items: packages.map((item) => {
      const capacity = item.capacity ?? null;

      const remainingQuantity =
        capacity !== null ? capacity - item.soldQuantity : null;

      return {
        id: item.id,
        type: item.type,
        name: item.name,
        description: item.description,

        regularPrice: Number(item.regularPrice),
        packagePrice: Number(item.packagePrice),
        durationMinutes: item.durationMinutes,

        status: item.status,
        listingStatus: item.listingStatus,

        capacity,
        soldQuantity: item.soldQuantity,
        remainingQuantity,

        soldOut:
          item.type === PackageType.GROUP_PURCHASE_PACKAGE
            ? remainingQuantity !== null && remainingQuantity <= 0
            : false,

        primaryImageObjectKey: item.images[0]?.objectKey || null,

        services: item.services.map((serviceItem) => ({
          id: serviceItem.service.id,
          name: serviceItem.service.name,
        })),

        branches: item.branches.map((branchItem) => ({
          id: branchItem.branch.id,
          name: branchItem.branch.name,
        })),
      };
    }),

    pagination: {
      page,
      limit,
      total: totalPackageCount,
      totalPages: Math.ceil(totalPackageCount / limit),
      hasNextPage: page < Math.ceil(totalPackageCount / limit),
      hasPreviousPage: page > 1,
    },
  };
};

const getPackageById = async (packageId: string) => {
  const packageData = await prisma.package.findUnique({
    where: {
      id: packageId,
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

      services: {
        select: {
          service: {
            select: {
              id: true,
              name: true,
              price: true,
              durationMinutes: true,
              status: true,
            },
          },
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

  if (!packageData) {
    throw new AppError("Package not found", 404);
  }

  const capacity = packageData.capacity ?? null;

  const remainingQuantity =
    capacity !== null ? capacity - packageData.soldQuantity : null;

  return {
    id: packageData.id,
    type: packageData.type,
    name: packageData.name,
    description: packageData.description,

    regularPrice: Number(packageData.regularPrice),
    packagePrice: Number(packageData.packagePrice),
    durationMinutes: packageData.durationMinutes,

    status: packageData.status,
    listingStatus: packageData.listingStatus,

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

    images: packageData.images.map((image) => ({
      id: image.id,
      objectKey: image.objectKey,
      isPrimary: image.isPrimary,
      sortOrder: image.sortOrder,
    })),

    services: packageData.services.map((item) => ({
      id: item.service.id,
      name: item.service.name,
      price: Number(item.service.price),
      durationMinutes: item.service.durationMinutes,
      status: item.service.status,
    })),

    branches: packageData.branches.map((item) => ({
      id: item.branch.id,
      name: item.branch.name,
      status: item.branch.status,
    })),
  };
};

const updatePackage = async (
  packageId: string,
  payload: IUpdatePackagePayload,
) => {
  const packageData = await prisma.package.findUnique({
    where: {
      id: packageId,
    },
  });

  if (!packageData) {
    throw new AppError("Package not found", 404);
  }

  if (payload.name) {
    const existingPackage = await prisma.package.findFirst({
      where: {
        name: {
          equals: payload.name.trim(),
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

  const regularPrice = payload.regularPrice ?? Number(packageData.regularPrice);

  const packagePrice = payload.packagePrice ?? Number(packageData.packagePrice);

  if (packagePrice > regularPrice) {
    throw new AppError(
      "Package price cannot be greater than regular price",
      400,
    );
  }

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

  if (packageData.type === PackageType.GROUP_PURCHASE_PACKAGE) {
    const capacity = payload.capacity ?? packageData.capacity;

    const purchaseLimit =
      payload.purchaseLimitPerCustomer ?? packageData.purchaseLimitPerCustomer;

    const salesStartAt = payload.salesStartAt
      ? new Date(payload.salesStartAt)
      : packageData.salesStartAt;

    const salesEndAt = payload.salesEndAt
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

  const updatedPackage = await prisma.package.update({
    where: {
      id: packageId,
    },

    data: {
      ...(payload.name !== undefined && {
        name: payload.name.trim(),
      }),

      ...(payload.description !== undefined && {
        description: payload.description.trim(),
      }),

      ...(payload.regularPrice !== undefined && {
        regularPrice: payload.regularPrice,
      }),

      ...(payload.packagePrice !== undefined && {
        packagePrice: payload.packagePrice,
      }),

      ...(payload.durationMinutes !== undefined && {
        durationMinutes: payload.durationMinutes,
      }),

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

  return {
    id: updatedPackage.id,
    name: updatedPackage.name,
    packagePrice: Number(updatedPackage.packagePrice),
    capacity: updatedPackage.capacity,
  };
};

const updatePackageStatus = async (
  packageId: string,
  payload: IUpdatePackageStatusPayload,
) => {
  const packageData = await prisma.package.findUnique({
    where: {
      id: packageId,
    },
  });

  if (!packageData) {
    throw new AppError("Package not found", 404);
  }

  const updatedPackage = await prisma.package.update({
    where: {
      id: packageId,
    },
    data: {
      status: payload.status,
    },
  });

  return {
    id: updatedPackage.id,
    status: updatedPackage.status,
  };
};

const updatePackageListing = async (
  packageId: string,
  payload: IUpdatePackageListingPayload,
) => {
  const packageData = await prisma.package.findUnique({
    where: {
      id: packageId,
    },
  });

  if (!packageData) {
    throw new AppError("Package not found", 404);
  }

  const updatedPackage = await prisma.package.update({
    where: {
      id: packageId,
    },
    data: {
      listingStatus: payload.listingStatus,
    },
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
) => {
  const limit = query.limit ? Number(query.limit) : 20;
  const page = query.page ? Number(query.page) : 1;
  const skip = (page - 1) * limit;

  const type = query.type as PackageType | undefined;

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

  const packages = await prisma.package.findMany({
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

      services: {
        select: {
          service: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
    },
  });

  const totalPackageCount = await prisma.package.count({
    where: {
      AND: andConditions,
    },
  });

  const now = new Date();

  return {
    items: packages.map((item) => {
      const capacity = item.capacity ?? null;

      const remainingQuantity =
        capacity !== null ? Math.max(capacity - item.soldQuantity, 0) : null;

      const soldOut =
        item.type === PackageType.GROUP_PURCHASE_PACKAGE && capacity !== null
          ? item.soldQuantity >= capacity
          : false;

      const groupPurchaseAvailable =
        item.type === PackageType.GROUP_PURCHASE_PACKAGE
          ? !soldOut &&
            item.salesStartAt !== null &&
            item.salesEndAt !== null &&
            now >= item.salesStartAt &&
            now <= item.salesEndAt
          : null;

      return {
        id: item.id,
        type: item.type,
        name: item.name,
        description: item.description,

        regularPrice: Number(item.regularPrice),
        packagePrice: Number(item.packagePrice),
        durationMinutes: item.durationMinutes,

        primaryImageObjectKey: item.images[0]?.objectKey || null,

        services: item.services.map((serviceItem) => ({
          id: serviceItem.service.id,
          name: serviceItem.service.name,
        })),

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

    pagination: {
      page,
      limit,
      total: totalPackageCount,
      totalPages: Math.ceil(totalPackageCount / limit),
      hasNextPage: page < Math.ceil(totalPackageCount / limit),
      hasPreviousPage: page > 1,
    },
  };
};

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
