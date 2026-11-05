import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../utils/app-error.js";
import {
  Role,
  ServiceStatus,
  StaffPortfolioStatus,
  StaffStatus,
} from "../../../../generated/prisma/enums.js";
import { DEFAULT_LANGUAGE, Language } from "../../utils/language.js";
import { getLocalizedContent } from "../../utils/localization.js";
import { uploadService } from "../upload/upload.service.js";
import { Prisma } from "../../../../generated/prisma/client.js";

const getBranchPortfolio = async (
  branchId: string,
  query: {
    page?: number | string;
    limit?: number | string;
    serviceId?: string;
    staffId?: string;
  },
  language: Language = DEFAULT_LANGUAGE,
) => {
  // =====================================================
  // 1. VALIDATE PAGINATION
  // =====================================================

  const page = Number(query.page ?? 1);
  const limit = Number(query.limit ?? 20);

  if (!Number.isInteger(page) || page < 1) {
    throw new AppError("page must be at least 1", 400);
  }

  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new AppError("limit must be between 1 and 100", 400);
  }

  const skip = (page - 1) * limit;

  // =====================================================
  // 2. VERIFY ACTIVE BRANCH
  // =====================================================

  const branch = await prisma.branch.findUnique({
    where: {
      id: branchId,
    },
    select: {
      id: true,
      name: true,
      translations: true,
      status: true,
    },
  });

  if (!branch) {
    throw new AppError("Branch not found", 404);
  }

  if (branch.status !== "ACTIVE") {
    throw new AppError("Branch portfolio is not available", 404);
  }

  // =====================================================
  // 3. BUILD FILTERS
  // =====================================================

  const staffWhere = {
    branchId,
    status: StaffPortfolioStatus.PUBLISHED,
    showInBranchPortfolio: true,

    ...(query.serviceId ? { serviceId: query.serviceId } : {}),

    ...(query.staffId ? { staffId: query.staffId } : {}),

    staff: {
      status: "ACTIVE" as const,
    },
  };

  const branchWhere = {
    branchId,
    status: StaffPortfolioStatus.PUBLISHED,

    ...(query.serviceId ? { serviceId: query.serviceId } : {}),

    ...(query.staffId ? { staffId: query.staffId } : {}),
  };

  // =====================================================
  // 4. FETCH BOTH SOURCES
  // =====================================================

  const [staffCases, branchCases, staffTotal, branchTotal] = await Promise.all([
    prisma.staffPortfolioCase.findMany({
      where: staffWhere,

      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }, { id: "asc" }],

      select: {
        id: true,
        staffId: true,
        branchId: true,
        serviceId: true,
        title: true,
        description: true,
        tags: true,
        translations: true,
        status: true,
        sortOrder: true,
        createdAt: true,
        updatedAt: true,

        staff: {
          select: {
            id: true,
            name: true,
          },
        },

        service: {
          select: {
            id: true,
            name: true,
            translations: true,
          },
        },

        images: {
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          select: {
            id: true,
            objectKey: true,
            isCover: true,
            sortOrder: true,
          },
        },
      },
    }),

    prisma.branchPortfolioCase.findMany({
      where: branchWhere,

      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }, { id: "asc" }],

      select: {
        id: true,
        branchId: true,
        staffId: true,
        serviceId: true,
        title: true,
        description: true,
        tags: true,
        translations: true,
        status: true,
        sortOrder: true,
        createdAt: true,
        updatedAt: true,

        staff: {
          select: {
            id: true,
            name: true,
          },
        },

        service: {
          select: {
            id: true,
            name: true,
            translations: true,
          },
        },

        images: {
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          select: {
            id: true,
            objectKey: true,
            isCover: true,
            sortOrder: true,
          },
        },
      },
    }),

    prisma.staffPortfolioCase.count({
      where: staffWhere,
    }),

    prisma.branchPortfolioCase.count({
      where: branchWhere,
    }),
  ]);

  // =====================================================
  // 5. NORMALIZE BOTH SOURCES
  // =====================================================

  const normalizedStaffCases = staffCases.map((item) => ({
    ...item,
    source: "STAFF" as const,
  }));

  const normalizedBranchCases = branchCases.map((item) => ({
    ...item,
    source: "BRANCH" as const,
  }));

  // =====================================================
  // 6. GLOBAL SORT + PAGINATION
  // =====================================================

  const mergedCases = [...normalizedStaffCases, ...normalizedBranchCases].sort(
    (a, b) => {
      if (a.sortOrder !== b.sortOrder) {
        return a.sortOrder - b.sortOrder;
      }

      const dateDifference = b.createdAt.getTime() - a.createdAt.getTime();

      if (dateDifference !== 0) {
        return dateDifference;
      }

      const sourceComparison = a.source.localeCompare(b.source);

      if (sourceComparison !== 0) {
        return sourceComparison;
      }

      return a.id.localeCompare(b.id);
    },
  );

  const paginatedCases = mergedCases.slice(skip, skip + limit);

  // =====================================================
  // 7. LOCALIZE + GENERATE IMAGE URLS
  // =====================================================

  const items = await Promise.all(
    paginatedCases.map(async (item) => {
      const localizedCase = getLocalizedContent(item.translations, language, {
        title: item.title,
        description: item.description ?? "",
      });

      const localizedService = item.service
        ? getLocalizedContent(item.service.translations, language, {
            name: item.service.name,
          })
        : null;

      const images = await Promise.all(
        item.images.map(async (image) => ({
          id: image.id,
          objectKey: image.objectKey,
          imageUrl: await uploadService.getImageUrl(image.objectKey),
          isCover: image.isCover,
          sortOrder: image.sortOrder,
        })),
      );

      const coverImage =
        images.find((image) => image.isCover) ?? images[0] ?? null;

      return {
        id: item.id,
        source: item.source,

        branchId: item.branchId,
        staffId: item.staffId,
        serviceId: item.serviceId,

        title: localizedCase.title,
        description: localizedCase.description || null,

        tags: item.tags,

        status: item.status,
        sortOrder: item.sortOrder,

        staff: item.staff
          ? {
              id: item.staff.id,
              name: item.staff.name,
            }
          : null,

        service: item.service
          ? {
              id: item.service.id,
              name: localizedService!.name,
            }
          : null,

        coverImage,
        images,
        imageCount: images.length,

        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      };
    }),
  );

  // =====================================================
  // 8. LOCALIZE BRANCH
  // =====================================================

  const localizedBranch = getLocalizedContent(branch.translations, language, {
    name: branch.name,
  });

  // =====================================================
  // 9. PAGINATION
  // =====================================================

  const total = staffTotal + branchTotal;

  const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

  // =====================================================
  // 10. FINAL RESPONSE
  // =====================================================

  return {
    branch: {
      id: branch.id,
      name: localizedBranch.name,
    },

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

const createBranchPortfolioCase = async (
  branchId: string,
  requester: {
    id: string;
    role: Role;
  },
  payload: {
    title: string;
    description?: string | null;
    serviceId?: string | null;
    staffId?: string | null;
    tags?: string[];
    translations?: Prisma.InputJsonValue;
    sortOrder?: number;
  },
) => {
  // =====================================================
  // 1. AUTHORIZATION
  // =====================================================

  if (requester.role !== Role.BRAND_OWNER) {
    throw new AppError(
      "Only brand owners can create branch portfolio cases",
      403,
    );
  }

  // =====================================================
  // 2. VERIFY BRANCH
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

  if (branch.status !== "ACTIVE") {
    throw new AppError(
      "Cannot create portfolio cases for an inactive branch",
      400,
    );
  }

  // =====================================================
  // 3. VALIDATE TITLE
  // =====================================================

  const title = payload.title.trim();

  if (!title) {
    throw new AppError("Portfolio title is required", 400);
  }

  // =====================================================
  // 4. VERIFY OPTIONAL SERVICE
  // =====================================================

  if (payload.serviceId) {
    const service = await prisma.service.findUnique({
      where: {
        id: payload.serviceId,
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

    if (!service || service.status !== ServiceStatus.ACTIVE) {
      throw new AppError("Active service not found", 404);
    }

    if (service.branches.length === 0) {
      throw new AppError("Service is not assigned to this branch", 400);
    }
  }

  // =====================================================
  // 5. VERIFY OPTIONAL STAFF
  // =====================================================

  if (payload.staffId) {
    const staff = await prisma.staff.findUnique({
      where: {
        id: payload.staffId,
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
        services: {
          select: {
            serviceId: true,
          },
        },
      },
    });

    if (!staff || staff.status !== StaffStatus.ACTIVE) {
      throw new AppError("Active staff not found", 404);
    }

    if (staff.branches.length === 0) {
      throw new AppError("Staff is not assigned to this branch", 400);
    }

    if (
      payload.serviceId &&
      !staff.services.some((service) => service.serviceId === payload.serviceId)
    ) {
      throw new AppError("Selected service is not assigned to this staff", 400);
    }
  }

  // =====================================================
  // 6. CREATE PORTFOLIO CASE
  // =====================================================

  const portfolioCase = await prisma.branchPortfolioCase.create({
    data: {
      branchId,
      title,
      description: payload.description ?? null,
      serviceId: payload.serviceId ?? null,
      staffId: payload.staffId ?? null,

      tags: payload.tags ?? [],

      ...(payload.translations !== undefined
        ? { translations: payload.translations }
        : {}),

      status: StaffPortfolioStatus.DRAFT,
      sortOrder: payload.sortOrder ?? 0,
    },

    select: {
      id: true,
      branchId: true,
      staffId: true,
      serviceId: true,
      title: true,
      description: true,
      tags: true,
      translations: true,
      status: true,
      sortOrder: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  // =====================================================
  // 7. FINAL RESPONSE
  // =====================================================

  return portfolioCase;
};

const updateBranchPortfolioCase = async (
  branchId: string,
  caseId: string,
  requester: {
    id: string;
    role: Role;
  },
  payload: {
    title?: string;
    description?: string | null;
    serviceId?: string | null;
    staffId?: string | null;
    tags?: string[];
    translations?: Prisma.InputJsonValue | null;
    sortOrder?: number;
    status?: StaffPortfolioStatus;
  },
) => {
  // =====================================================
  // 1. AUTHORIZATION
  // =====================================================

  if (requester.role !== Role.BRAND_OWNER) {
    throw new AppError(
      "Only brand owners can update branch portfolio cases",
      403,
    );
  }

  // =====================================================
  // 2. VERIFY EXISTING PORTFOLIO CASE
  // =====================================================

  const existingCase = await prisma.branchPortfolioCase.findFirst({
    where: {
      id: caseId,
      branchId,
    },
    select: {
      id: true,
      branchId: true,
      staffId: true,
      serviceId: true,
      status: true,
    },
  });

  if (!existingCase) {
    throw new AppError("Branch portfolio case not found", 404);
  }

  // =====================================================
  // 3. VALIDATE TITLE AND SORT ORDER
  // =====================================================

  if (payload.title !== undefined && !payload.title.trim()) {
    throw new AppError("Portfolio title cannot be empty", 400);
  }

  if (
    payload.sortOrder !== undefined &&
    (!Number.isInteger(payload.sortOrder) || payload.sortOrder < 0)
  ) {
    throw new AppError("sortOrder must be a non-negative integer", 400);
  }

  // =====================================================
  // 4. RESOLVE FINAL SERVICE AND STAFF
  // =====================================================

  const finalServiceId =
    payload.serviceId !== undefined
      ? payload.serviceId
      : existingCase.serviceId;

  const finalStaffId =
    payload.staffId !== undefined ? payload.staffId : existingCase.staffId;

  // =====================================================
  // 5. VERIFY SERVICE ASSOCIATION
  // =====================================================

  if (finalServiceId) {
    const service = await prisma.service.findUnique({
      where: {
        id: finalServiceId,
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

    if (!service || service.status !== ServiceStatus.ACTIVE) {
      throw new AppError("Active service not found", 404);
    }

    if (service.branches.length === 0) {
      throw new AppError("Service is not assigned to this branch", 400);
    }
  }

  // =====================================================
  // 6. VERIFY STAFF ASSOCIATION
  // =====================================================

  if (finalStaffId) {
    const staff = await prisma.staff.findUnique({
      where: {
        id: finalStaffId,
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
        services: {
          select: {
            serviceId: true,
          },
        },
      },
    });

    if (!staff || staff.status !== StaffStatus.ACTIVE) {
      throw new AppError("Active staff not found", 404);
    }

    if (staff.branches.length === 0) {
      throw new AppError("Staff is not assigned to this branch", 400);
    }

    if (
      finalServiceId &&
      !staff.services.some((service) => service.serviceId === finalServiceId)
    ) {
      throw new AppError("Selected service is not assigned to this staff", 400);
    }
  }

  // =====================================================
  // 7. BUILD UPDATE DATA
  // =====================================================

  const data: Prisma.BranchPortfolioCaseUncheckedUpdateInput = {};

  if (payload.title !== undefined) {
    data.title = payload.title.trim();
  }

  if (payload.description !== undefined) {
    data.description = payload.description;
  }

  if (payload.serviceId !== undefined) {
    data.serviceId = payload.serviceId;
  }

  if (payload.staffId !== undefined) {
    data.staffId = payload.staffId;
  }

  if (payload.tags !== undefined) {
    data.tags = payload.tags;
  }

  if (payload.translations !== undefined) {
    data.translations =
      payload.translations === null ? Prisma.DbNull : payload.translations;
  }

  if (payload.sortOrder !== undefined) {
    data.sortOrder = payload.sortOrder;
  }

  if (payload.status !== undefined) {
    data.status = payload.status;
  }

  // =====================================================
  // 8. UPDATE PORTFOLIO CASE
  // =====================================================

  const updatedCase = await prisma.branchPortfolioCase.update({
    where: {
      id: existingCase.id,
    },
    data,
    select: {
      id: true,
      branchId: true,
      staffId: true,
      serviceId: true,
      title: true,
      description: true,
      tags: true,
      translations: true,
      status: true,
      sortOrder: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  // =====================================================
  // 9. FINAL RESPONSE
  // =====================================================

  return updatedCase;
};

const addBranchPortfolioImages = async (
  branchId: string,
  caseId: string,
  requester: {
    id: string;
    role: Role;
  },
  payload: {
    images: {
      objectKey: string;
      isCover?: boolean;
    }[];
  },
) => {
  // =====================================================
  // 1. AUTHORIZATION
  // =====================================================

  if (requester.role !== Role.BRAND_OWNER) {
    throw new AppError(
      "Only brand owners can manage branch portfolio images",
      403,
    );
  }

  // =====================================================
  // 2. VERIFY PORTFOLIO CASE
  // =====================================================

  const portfolioCase = await prisma.branchPortfolioCase.findFirst({
    where: {
      id: caseId,
      branchId,
    },
    select: {
      id: true,
      images: {
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          objectKey: true,
          isCover: true,
          sortOrder: true,
        },
      },
    },
  });

  if (!portfolioCase) {
    throw new AppError("Branch portfolio case not found", 404);
  }

  // =====================================================
  // 3. VALIDATE IMAGE KEYS
  // =====================================================

  if (payload.images.length === 0) {
    throw new AppError("At least one image is required", 400);
  }

  const incomingKeys = payload.images.map((image) => image.objectKey);

  if (new Set(incomingKeys).size !== incomingKeys.length) {
    throw new AppError("Duplicate image keys are not allowed", 400);
  }

  const existingKeys = new Set(
    portfolioCase.images.map((image) => image.objectKey),
  );

  if (incomingKeys.some((key) => existingKeys.has(key))) {
    throw new AppError(
      "One or more images already belong to this portfolio case",
      409,
    );
  }

  const requestedCoverCount = payload.images.filter(
    (image) => image.isCover === true,
  ).length;

  if (requestedCoverCount > 1) {
    throw new AppError("Only one cover image is allowed", 400);
  }

  // =====================================================
  // 4. DETERMINE COVER IMAGE
  // =====================================================

  const existingCover = portfolioCase.images.find((image) => image.isCover);

  const requestedCoverIndex = payload.images.findIndex(
    (image) => image.isCover === true,
  );

  const shouldSetNewCover =
    requestedCoverIndex >= 0 ||
    portfolioCase.images.length === 0 ||
    !existingCover;

  const newCoverIndex = requestedCoverIndex >= 0 ? requestedCoverIndex : 0;

  const maxSortOrder = portfolioCase.images.reduce(
    (max, image) => Math.max(max, image.sortOrder),
    -1,
  );

  // =====================================================
  // 5. CREATE IMAGES IN TRANSACTION
  // =====================================================

  const createdImages = await prisma.$transaction(async (tx) => {
    if (shouldSetNewCover) {
      await tx.branchPortfolioCaseImage.updateMany({
        where: {
          caseId,
          isCover: true,
        },
        data: {
          isCover: false,
        },
      });
    }

    const created = [];

    for (let index = 0; index < payload.images.length; index++) {
      const image = payload.images[index];

      const result = await tx.branchPortfolioCaseImage.create({
        data: {
          caseId,
          objectKey: image.objectKey,
          sortOrder: maxSortOrder + index + 1,
          isCover: shouldSetNewCover && index === newCoverIndex,
        },
        select: {
          id: true,
          objectKey: true,
          isCover: true,
          sortOrder: true,
        },
      });

      created.push(result);
    }

    return created;
  });

  // =====================================================
  // 6. GENERATE IMAGE URLS
  // =====================================================

  const images = await Promise.all(
    createdImages.map(async (image) => ({
      ...image,
      imageUrl: await uploadService.getImageUrl(image.objectKey),
    })),
  );

  // =====================================================
  // 7. FINAL RESPONSE
  // =====================================================

  return {
    caseId,
    images,
    addedCount: images.length,
  };
};

const reorderBranchPortfolioImages = async (
  branchId: string,
  caseId: string,
  requester: {
    id: string;
    role: Role;
  },
  payload: {
    imageIds: string[];
    coverImageId?: string;
  },
) => {
  // =====================================================
  // 1. AUTHORIZATION
  // =====================================================

  if (requester.role !== Role.BRAND_OWNER) {
    throw new AppError(
      "Only brand owners can reorder branch portfolio images",
      403,
    );
  }

  // =====================================================
  // 2. VERIFY CASE AND EXISTING IMAGES
  // =====================================================

  const portfolioCase = await prisma.branchPortfolioCase.findFirst({
    where: {
      id: caseId,
      branchId,
    },
    select: {
      id: true,
      images: {
        select: {
          id: true,
          isCover: true,
        },
      },
    },
  });

  if (!portfolioCase) {
    throw new AppError("Branch portfolio case not found", 404);
  }

  // =====================================================
  // 3. VALIDATE IMAGE ORDER
  // =====================================================

  const existingIds = portfolioCase.images.map((image) => image.id);

  if (
    payload.imageIds.length !== existingIds.length ||
    new Set(payload.imageIds).size !== payload.imageIds.length
  ) {
    throw new AppError(
      "imageIds must contain every portfolio image exactly once",
      400,
    );
  }

  const existingIdSet = new Set(existingIds);

  if (payload.imageIds.some((imageId) => !existingIdSet.has(imageId))) {
    throw new AppError("Invalid portfolio image ID", 400);
  }

  // =====================================================
  // 4. DETERMINE COVER IMAGE
  // =====================================================

  const currentCover = portfolioCase.images.find((image) => image.isCover);

  const coverImageId =
    payload.coverImageId ?? currentCover?.id ?? payload.imageIds[0];

  if (coverImageId && !existingIdSet.has(coverImageId)) {
    throw new AppError("Cover image must belong to this portfolio case", 400);
  }

  // =====================================================
  // 5. UPDATE IMAGE ORDER + COVER
  // =====================================================

  await prisma.$transaction(async (tx) => {
    for (let index = 0; index < payload.imageIds.length; index++) {
      await tx.branchPortfolioCaseImage.update({
        where: {
          id: payload.imageIds[index],
        },
        data: {
          sortOrder: index,
          isCover: payload.imageIds[index] === coverImageId,
        },
      });
    }
  });

  // =====================================================
  // 6. FETCH UPDATED IMAGES
  // =====================================================

  const updatedImages = await prisma.branchPortfolioCaseImage.findMany({
    where: {
      caseId,
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      objectKey: true,
      isCover: true,
      sortOrder: true,
    },
  });

  const images = await Promise.all(
    updatedImages.map(async (image) => ({
      ...image,
      imageUrl: await uploadService.getImageUrl(image.objectKey),
    })),
  );

  return {
    caseId,
    images,
    coverImage: images.find((image) => image.isCover) ?? null,
  };
};

const deleteBranchPortfolioImage = async (
  branchId: string,
  caseId: string,
  imageId: string,
  requester: {
    id: string;
    role: Role;
  },
) => {
  // =====================================================
  // 1. AUTHORIZATION
  // =====================================================

  if (requester.role !== Role.BRAND_OWNER) {
    throw new AppError(
      "Only brand owners can delete branch portfolio images",
      403,
    );
  }

  // =====================================================
  // 2. VERIFY CASE AND IMAGE
  // =====================================================

  const portfolioCase = await prisma.branchPortfolioCase.findFirst({
    where: {
      id: caseId,
      branchId,
    },
    select: {
      id: true,
      images: {
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          isCover: true,
        },
      },
    },
  });

  if (!portfolioCase) {
    throw new AppError("Branch portfolio case not found", 404);
  }

  const targetImage = portfolioCase.images.find(
    (image) => image.id === imageId,
  );

  if (!targetImage) {
    throw new AppError("Portfolio image not found", 404);
  }

  // =====================================================
  // 3. DELETE IMAGE AND REASSIGN COVER
  // =====================================================

  await prisma.$transaction(async (tx) => {
    await tx.branchPortfolioCaseImage.delete({
      where: {
        id: imageId,
      },
    });

    if (targetImage.isCover) {
      const nextImage = await tx.branchPortfolioCaseImage.findFirst({
        where: {
          caseId,
        },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
        },
      });

      if (nextImage) {
        await tx.branchPortfolioCaseImage.update({
          where: {
            id: nextImage.id,
          },
          data: {
            isCover: true,
          },
        });
      }
    }
  });

  // =====================================================
  // 4. FINAL RESPONSE
  // =====================================================

  return {
    caseId,
    deletedImageId: imageId,
    success: true,
  };
};

const getBranchPortfolioForManagement = async (
  branchId: string,
  requester: {
    id: string;
    role: Role;
  },
  query: {
    page?: number | string;
    limit?: number | string;
    status?: StaffPortfolioStatus;
    serviceId?: string;
    staffId?: string;
  },
  language: Language = DEFAULT_LANGUAGE,
) => {
  // =====================================================
  // 1. AUTHORIZATION
  // =====================================================

  if (requester.role !== Role.BRAND_OWNER) {
    throw new AppError(
      "Only brand owners can manage branch portfolio cases",
      403,
    );
  }

  // =====================================================
  // 2. VALIDATE PAGINATION
  // =====================================================

  const page = Number(query.page ?? 1);
  const limit = Number(query.limit ?? 20);

  if (!Number.isInteger(page) || page < 1) {
    throw new AppError("page must be at least 1", 400);
  }

  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new AppError("limit must be between 1 and 100", 400);
  }

  const skip = (page - 1) * limit;

  // =====================================================
  // 3. VERIFY BRANCH
  // =====================================================

  const branch = await prisma.branch.findUnique({
    where: {
      id: branchId,
    },
    select: {
      id: true,
      name: true,
      translations: true,
      status: true,
    },
  });

  if (!branch) {
    throw new AppError("Branch not found", 404);
  }

  // Allow owner to manage drafts even if branch is inactive.

  // =====================================================
  // 4. BUILD FILTERS
  // =====================================================

  const staffWhere: Prisma.StaffPortfolioCaseWhereInput = {
    branchId,

    ...(query.status ? { status: query.status } : {}),

    ...(query.serviceId ? { serviceId: query.serviceId } : {}),

    ...(query.staffId ? { staffId: query.staffId } : {}),
  };

  const branchWhere: Prisma.BranchPortfolioCaseWhereInput = {
    branchId,

    ...(query.status ? { status: query.status } : {}),

    ...(query.serviceId ? { serviceId: query.serviceId } : {}),

    ...(query.staffId ? { staffId: query.staffId } : {}),
  };

  // =====================================================
  // 5. FETCH STAFF + BRANCH PORTFOLIO
  // =====================================================

  const [staffCases, branchCases, staffTotal, branchTotal] = await Promise.all([
    prisma.staffPortfolioCase.findMany({
      where: staffWhere,

      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }, { id: "asc" }],

      select: {
        id: true,
        staffId: true,
        branchId: true,
        serviceId: true,
        title: true,
        description: true,
        tags: true,
        translations: true,
        status: true,
        sortOrder: true,
        createdAt: true,
        updatedAt: true,

        staff: {
          select: {
            id: true,
            name: true,
          },
        },

        service: {
          select: {
            id: true,
            name: true,
            translations: true,
          },
        },

        images: {
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          select: {
            id: true,
            objectKey: true,
            isCover: true,
            sortOrder: true,
          },
        },
      },
    }),

    prisma.branchPortfolioCase.findMany({
      where: branchWhere,

      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }, { id: "asc" }],

      select: {
        id: true,
        branchId: true,
        staffId: true,
        serviceId: true,
        title: true,
        description: true,
        tags: true,
        translations: true,
        status: true,
        sortOrder: true,
        createdAt: true,
        updatedAt: true,

        staff: {
          select: {
            id: true,
            name: true,
          },
        },

        service: {
          select: {
            id: true,
            name: true,
            translations: true,
          },
        },

        images: {
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          select: {
            id: true,
            objectKey: true,
            isCover: true,
            sortOrder: true,
          },
        },
      },
    }),

    prisma.staffPortfolioCase.count({
      where: staffWhere,
    }),

    prisma.branchPortfolioCase.count({
      where: branchWhere,
    }),
  ]);

  // =====================================================
  // 6. NORMALIZE SOURCES
  // =====================================================

  const normalizedStaffCases = staffCases.map((item) => ({
    ...item,
    source: "STAFF" as const,
  }));

  const normalizedBranchCases = branchCases.map((item) => ({
    ...item,
    source: "BRANCH" as const,
  }));

  // =====================================================
  // 7. GLOBAL SORT + PAGINATION
  // =====================================================

  const mergedCases = [...normalizedStaffCases, ...normalizedBranchCases].sort(
    (a, b) => {
      if (a.sortOrder !== b.sortOrder) {
        return a.sortOrder - b.sortOrder;
      }

      const dateDifference = b.createdAt.getTime() - a.createdAt.getTime();

      if (dateDifference !== 0) {
        return dateDifference;
      }

      const sourceComparison = a.source.localeCompare(b.source);

      if (sourceComparison !== 0) {
        return sourceComparison;
      }

      return a.id.localeCompare(b.id);
    },
  );

  const paginatedCases = mergedCases.slice(skip, skip + limit);

  // =====================================================
  // 8. LOCALIZE + GENERATE IMAGE URLS
  // =====================================================

  const items = await Promise.all(
    paginatedCases.map(async (item) => {
      const localizedCase = getLocalizedContent(item.translations, language, {
        title: item.title,
        description: item.description ?? "",
      });

      const localizedService = item.service
        ? getLocalizedContent(item.service.translations, language, {
            name: item.service.name,
          })
        : null;

      const images = await Promise.all(
        item.images.map(async (image) => ({
          id: image.id,
          objectKey: image.objectKey,
          imageUrl: await uploadService.getImageUrl(image.objectKey),
          isCover: image.isCover,
          sortOrder: image.sortOrder,
        })),
      );

      const coverImage =
        images.find((image) => image.isCover) ?? images[0] ?? null;

      return {
        id: item.id,
        source: item.source,

        branchId: item.branchId,
        staffId: item.staffId,
        serviceId: item.serviceId,

        title: localizedCase.title,
        description: localizedCase.description || null,

        tags: item.tags,

        // Important: return DRAFT / PUBLISHED status.
        status: item.status,
        sortOrder: item.sortOrder,

        staff: item.staff
          ? {
              id: item.staff.id,
              name: item.staff.name,
            }
          : null,

        service: item.service
          ? {
              id: item.service.id,
              name: localizedService!.name,
            }
          : null,

        coverImage,
        images,
        imageCount: images.length,

        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      };
    }),
  );

  // =====================================================
  // 9. LOCALIZE BRANCH
  // =====================================================

  const localizedBranch = getLocalizedContent(branch.translations, language, {
    name: branch.name,
  });

  // =====================================================
  // 10. PAGINATION
  // =====================================================

  const total = staffTotal + branchTotal;

  const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

  // =====================================================
  // 11. FINAL RESPONSE
  // =====================================================

  return {
    branch: {
      id: branch.id,
      name: localizedBranch.name,
    },

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

export const branchPortfolioService = {
  getBranchPortfolio,
  createBranchPortfolioCase,
  updateBranchPortfolioCase,
  deleteBranchPortfolioImage,
  reorderBranchPortfolioImages,
  addBranchPortfolioImages,
  getBranchPortfolioForManagement,
};
