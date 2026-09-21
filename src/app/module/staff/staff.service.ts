import bcrypt from "bcrypt";
import crypto from "crypto";

import {
  BranchStatus,
  PackageStatus,
  Prisma,
  Role,
  ServiceStatus,
  StaffStatus,
} from "../../../../generated/prisma/client.js";

import { prisma } from "../../lib/prisma.js";

import { AppError } from "../../utils/app-error.js";

import {
  IAssignStaffBranchesPayload,
  IAssignStaffPackagesPayload,
  IAssignStaffServicesPayload,
  ICreateStaffPayload,
  IUpdateStaffPayload,
  IUpdateStaffStatusPayload,
} from "./staff.interface.js";

const generateTemporaryPassword = () => {
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
) => {
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

  // Branch validation
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

  // Branch Manager scope check
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

  // Service validation
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

  // Service must be available in at least one assigned branch
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

  // Package validation
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

    // Staff must support ALL services inside package
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

  const temporaryPassword = generateTemporaryPassword();

  const passwordHash = await bcrypt.hash(temporaryPassword, 12);

  const result = await prisma.$transaction(async (tx) => {
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

    const staff = await tx.staff.create({
      data: {
        userId: user.id,

        name: payload.name.trim(),
        email,

        phone: payload.phone?.trim() || null,

        roleTitle: payload.roleTitle.trim(),

        specialization: payload.specialization?.trim() || null,

        description: payload.description?.trim() || null,

        avatarObjectKey: payload.avatarObjectKey || null,
      },
    });

    await tx.staffBranch.createMany({
      data: uniqueBranchIds.map((branchId) => ({
        staffId: staff.id,
        branchId,
      })),
    });

    if (uniqueServiceIds.length > 0) {
      await tx.staffService.createMany({
        data: uniqueServiceIds.map((serviceId) => ({
          staffId: staff.id,
          serviceId,
        })),
      });
    }

    if (uniquePackageIds.length > 0) {
      await tx.staffPackage.createMany({
        data: uniquePackageIds.map((packageId) => ({
          staffId: staff.id,
          packageId,
        })),
      });
    }

    return staff;
  });

  return {
    id: result.id,
    name: result.name,
    email: result.email,
    branchIds: uniqueBranchIds,
    serviceIds: uniqueServiceIds,
    packageIds: uniquePackageIds,
    status: result.status,

    temporaryPassword,
    mustChangePassword: true,
  };
};

const getStaff = async (
  query: Record<string, any>,
  requester: {
    userId: string;
    role: Role;
  },
) => {
  const page = query.page ? Number(query.page) : 1;
  const limit = query.limit ? Number(query.limit) : 20;
  const skip = (page - 1) * limit;

  const branchId = query.branchId as string | undefined;
  const status = query.status as StaffStatus | undefined;

  const andConditions: Prisma.StaffWhereInput[] = [];

  if (status) {
    andConditions.push({
      status,
    });
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

  const staffList = await prisma.staff.findMany({
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
            },
          },
        },
      },
    },
  });

  const total = await prisma.staff.count({
    where,
  });

  const totalPages = Math.ceil(total / limit);

  return {
    items: staffList.map((staff) => ({
      id: staff.id,
      name: staff.name,
      email: staff.email,
      phone: staff.phone,
      roleTitle: staff.roleTitle,
      specialization: staff.specialization,
      description: staff.description,
      avatarObjectKey: staff.avatarObjectKey,
      status: staff.status,

      branches: staff.branches.map((item) => ({
        id: item.branch.id,
        name: item.branch.name,
      })),

      services: staff.services.map((item) => ({
        id: item.service.id,
        name: item.service.name,
      })),

      packages: staff.packages.map((item) => ({
        id: item.package.id,
        name: item.package.name,
        type: item.package.type,
      })),
    })),

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
) => {
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

  // Branch Manager scope check
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

  return {
    id: staff.id,
    name: staff.name,
    email: staff.email,
    phone: staff.phone,
    roleTitle: staff.roleTitle,
    specialization: staff.specialization,
    description: staff.description,
    avatarObjectKey: staff.avatarObjectKey,
    status: staff.status,

    branches: staff.branches.map((item) => ({
      id: item.branch.id,
      name: item.branch.name,
      status: item.branch.status,
    })),

    services: staff.services.map((item) => ({
      id: item.service.id,
      name: item.service.name,
      price: Number(item.service.price),
      durationMinutes: item.service.durationMinutes,
      status: item.service.status,
    })),

    packages: staff.packages.map((item) => ({
      id: item.package.id,
      name: item.package.name,
      type: item.package.type,
      packagePrice: Number(item.package.packagePrice),
      durationMinutes: item.package.durationMinutes,
      status: item.package.status,
      listingStatus: item.package.listingStatus,
    })),

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
        "You are not allowed to update this staff member",
        403,
      );
    }
  }

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
          roleTitle: payload.roleTitle.trim(),
        }),

        ...(payload.specialization !== undefined && {
          specialization: payload.specialization.trim(),
        }),

        ...(payload.description !== undefined && {
          description: payload.description.trim(),
        }),

        ...(payload.avatarObjectKey !== undefined && {
          avatarObjectKey: payload.avatarObjectKey,
        }),
      },
    });

    // Keep User profile consistent
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

  return {
    id: updatedStaff.id,
    name: updatedStaff.name,
    phone: updatedStaff.phone,
    roleTitle: updatedStaff.roleTitle,
    specialization: updatedStaff.specialization,
    description: updatedStaff.description,
    avatarObjectKey: updatedStaff.avatarObjectKey,
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

  // Branch Manager scope check
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

  const updatedStaff = await prisma.staff.update({
    where: {
      id: staffId,
    },

    data: {
      status: payload.status,
    },
  });

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

  const inactiveBranch = branches.find(
    (branch) => branch.status !== BranchStatus.ACTIVE,
  );

  if (inactiveBranch) {
    throw new AppError("Staff cannot be assigned to an inactive branch", 400);
  }

  // Branch Manager scope check
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

    // Manager must already have access to this staff
    const hasCurrentAccess = staff.branches.some((item) =>
      allowedBranchIds.has(item.branchId),
    );

    if (!hasCurrentAccess) {
      throw new AppError(
        "You are not allowed to manage this staff member",
        403,
      );
    }

    // Manager cannot assign outside own scope
    const unauthorizedBranch = uniqueBranchIds.find(
      (branchId) => !allowedBranchIds.has(branchId),
    );

    if (unauthorizedBranch) {
      throw new AppError(
        "You are not allowed to assign staff outside your branch scope",
        403,
      );
    }

    // Requirement: manager cannot perform cross-branch reassignment
    if (uniqueBranchIds.length > 1) {
      throw new AppError(
        "Branch Manager cannot assign staff across multiple branches",
        403,
      );
    }
  }

  // Every assigned service must be available
  // in at least one of the final staff branches
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

  // Every assigned package must be available
  // in at least one final staff branch
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

  await prisma.$transaction(async (tx) => {
    await tx.staffBranch.deleteMany({
      where: {
        staffId,
      },
    });

    await tx.staffBranch.createMany({
      data: uniqueBranchIds.map((branchId) => ({
        staffId,
        branchId,
      })),
    });
  });

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

const getBranchStaff = async (branchId: string) => {
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
      avatarObjectKey: true,
    },

    orderBy: {
      name: "asc",
    },
  });

  return {
    items: staff.map((item) => ({
      id: item.id,
      name: item.name,
      roleTitle: item.roleTitle,
      specialization: item.specialization,

      // Temporary until Cloudflare R2 URL generation is implemented
      avatarObjectKey: item.avatarObjectKey,
    })),
  };
};

const getEligibleStaffForService = async (
  branchId: string,
  serviceId: string,
) => {
  // Check branch
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

  // Check service
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

  // Important:
  // Service must actually belong to the selected branch
  if (service.branches.length === 0) {
    throw new AppError("Service is not available in this branch", 400);
  }

  // Staff must satisfy ALL:
  // 1. ACTIVE
  // 2. assigned to selected branch
  // 3. assigned to selected service
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
      avatarObjectKey: true,
    },

    orderBy: {
      name: "asc",
    },
  });

  return {
    items: staff.map((item) => ({
      id: item.id,
      name: item.name,
      roleTitle: item.roleTitle,
      specialization: item.specialization,

      // Temporary until R2 URL generation
      avatarObjectKey: item.avatarObjectKey,
    })),
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
};
