import { Prisma } from "../../../../generated/prisma/client.js";
import {
  AppointmentStatus,
  ReviewModerationStatus,
  Role,
  ServiceStatus,
  StaffPortfolioStatus,
  StaffStatus,
} from "../../../../generated/prisma/enums.js";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../utils/app-error.js";
import { DEFAULT_LANGUAGE, Language } from "../../utils/language.js";
import { getLocalizedContent } from "../../utils/localization.js";
import { uploadService } from "../upload/upload.service.js";

const getStaffPortfolio = async (
  staffId: string,
  language: Language = DEFAULT_LANGUAGE,
) => {
  // =====================================================
  // 1. FETCH STAFF PROFILE + ASSIGNED SERVICES + BRANCHES
  // =====================================================

  const staff = await prisma.staff.findUnique({
    where: {
      id: staffId,
    },

    select: {
      id: true,
      name: true,
      roleTitle: true,
      specialization: true,
      description: true,
      avatarObjectKey: true,
      translations: true,
      status: true,

      branches: {
        where: {
          branch: {
            status: "ACTIVE",
          },
        },
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

      services: {
        where: {
          service: {
            status: ServiceStatus.ACTIVE,
          },
        },
        select: {
          service: {
            select: {
              id: true,
              name: true,
              description: true,
              price: true,
              durationMinutes: true,
              translations: true,
            },
          },
        },
      },
    },
  });

  if (!staff) {
    throw new AppError("Staff not found", 404);
  }

  // Public portfolio is only available for active staff.
  if (staff.status !== StaffStatus.ACTIVE) {
    throw new AppError("Staff portfolio is not available", 404);
  }

  // =====================================================
  // 2. CALCULATE LAST SIX MONTHS
  // =====================================================

  const now = new Date();

  const sixMonthsAgo = new Date(now);
  sixMonthsAgo.setUTCMonth(sixMonthsAgo.getUTCMonth() - 6);

  // =====================================================
  // 3. FETCH REVIEW + PERFORMANCE STATISTICS
  // =====================================================

  const [reviewStats, positiveReviews, completedAppointments] =
    await Promise.all([
      prisma.review.aggregate({
        where: {
          staffId,
          moderationStatus: ReviewModerationStatus.VISIBLE,
        },
        _avg: {
          rating: true,
        },
        _count: {
          _all: true,
        },
      }),

      prisma.review.count({
        where: {
          staffId,
          moderationStatus: ReviewModerationStatus.VISIBLE,
          rating: {
            gte: 4,
          },
        },
      }),

      prisma.appointment.count({
        where: {
          staffId,
          appointmentStatus: AppointmentStatus.COMPLETED,
          completedAt: {
            gte: sixMonthsAgo,
            lte: now,
          },
        },
      }),
    ]);

  // =====================================================
  // 4. GENERATE SIGNED AVATAR URL
  // =====================================================

  const avatarUrl = staff.avatarObjectKey
    ? await uploadService.getImageUrl(staff.avatarObjectKey)
    : null;

  // =====================================================
  // 5. LOCALIZE STAFF PROFILE
  // =====================================================

  const localizedStaff = getLocalizedContent(staff.translations, language, {
    roleTitle: staff.roleTitle,
    specialization: staff.specialization ?? "",
    description: staff.description ?? "",
  });

  // =====================================================
  // 6. LOCALIZE ASSIGNED SERVICES
  // =====================================================

  const services = staff.services.map(({ service }) => {
    const localizedService = getLocalizedContent(
      service.translations,
      language,
      {
        name: service.name,
        description: service.description ?? "",
      },
    );

    return {
      id: service.id,
      name: localizedService.name,
      description: localizedService.description || null,
      price: Number(service.price),
      durationMinutes: service.durationMinutes,
    };
  });

  // =====================================================
  // 7. LOCALIZE BRANCHES
  // =====================================================

  const branches = staff.branches.map(({ branch }) => {
    const localizedBranch = getLocalizedContent(branch.translations, language, {
      name: branch.name,
    });

    return {
      id: branch.id,
      name: localizedBranch.name,
    };
  });

  // =====================================================
  // 8. FINAL RESPONSE
  // =====================================================

  return {
    staff: {
      id: staff.id,
      name: staff.name,
      roleTitle: localizedStaff.roleTitle,
      specialization: localizedStaff.specialization || null,
      description: localizedStaff.description || null,
      avatarObjectKey: staff.avatarObjectKey,
      avatarUrl,
      status: staff.status,
    },

    statistics: {
      averageRating: Math.round((reviewStats._avg.rating ?? 0) * 10) / 10,

      totalReviews: reviewStats._count._all,

      positiveReviews,

      completedServicesLastSixMonths: completedAppointments,
    },

    branches,

    services,
  };
};

const getPublishedPortfolioCases = async (
  staffId: string,
  query: {
    page?: number | string;
    limit?: number | string;
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
  // 2. VERIFY STAFF
  // =====================================================

  const staff = await prisma.staff.findUnique({
    where: {
      id: staffId,
    },
    select: {
      id: true,
      status: true,
    },
  });

  if (!staff) {
    throw new AppError("Staff not found", 404);
  }

  if (staff.status !== StaffStatus.ACTIVE) {
    throw new AppError("Staff portfolio is not available", 404);
  }

  // =====================================================
  // 3. FETCH PUBLISHED CASES + TOTAL COUNT
  // =====================================================

  const where = {
    staffId,
    status: StaffPortfolioStatus.PUBLISHED,
  };

  const [cases, total] = await Promise.all([
    prisma.staffPortfolioCase.findMany({
      where,

      skip,
      take: limit,

      orderBy: [
        {
          sortOrder: "asc",
        },
        {
          createdAt: "desc",
        },
      ],

      select: {
        id: true,
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

        service: {
          select: {
            id: true,
            name: true,
            translations: true,
          },
        },

        images: {
          orderBy: [
            {
              sortOrder: "asc",
            },
            {
              createdAt: "asc",
            },
          ],

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
      where,
    }),
  ]);

  // =====================================================
  // 4. LOCALIZE CASES + GENERATE SIGNED IMAGE URLS
  // =====================================================

  const items = await Promise.all(
    cases.map(async (portfolioCase) => {
      const localizedCase = getLocalizedContent(
        portfolioCase.translations,
        language,
        {
          title: portfolioCase.title,
          description: portfolioCase.description ?? "",
        },
      );

      const images = await Promise.all(
        portfolioCase.images.map(async (image) => ({
          id: image.id,
          objectKey: image.objectKey,
          imageUrl: await uploadService.getImageUrl(image.objectKey),
          isCover: image.isCover,
          sortOrder: image.sortOrder,
        })),
      );

      const coverImage =
        images.find((image) => image.isCover) ?? images[0] ?? null;

      const localizedService = portfolioCase.service
        ? getLocalizedContent(portfolioCase.service.translations, language, {
            name: portfolioCase.service.name,
          })
        : null;

      return {
        id: portfolioCase.id,
        staffId: portfolioCase.staffId,

        title: localizedCase.title,
        description: localizedCase.description || null,

        tags: portfolioCase.tags,

        status: portfolioCase.status,
        sortOrder: portfolioCase.sortOrder,

        service: portfolioCase.service
          ? {
              id: portfolioCase.service.id,
              name: localizedService!.name,
            }
          : null,

        coverImage,

        images,

        imageCount: images.length,

        createdAt: portfolioCase.createdAt,
        updatedAt: portfolioCase.updatedAt,
      };
    }),
  );

  // =====================================================
  // 5. PAGINATION
  // =====================================================

  const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

  // =====================================================
  // 6. FINAL RESPONSE
  // =====================================================

  return {
    staffId,

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

// =====================================================
// API 03 — GET SINGLE PUBLISHED PORTFOLIO CASE
// =====================================================

const getPublishedPortfolioCaseById = async (
  staffId: string,
  caseId: string,
  language: Language = DEFAULT_LANGUAGE,
) => {
  // =====================================================
  // 1. VERIFY STAFF
  // =====================================================

  const staff = await prisma.staff.findUnique({
    where: {
      id: staffId,
    },
    select: {
      id: true,
      name: true,
      status: true,
      avatarObjectKey: true,
    },
  });

  if (!staff) {
    throw new AppError("Staff not found", 404);
  }

  if (staff.status !== StaffStatus.ACTIVE) {
    throw new AppError("Staff portfolio is not available", 404);
  }

  // =====================================================
  // 2. FETCH PUBLISHED CASE
  // =====================================================

  const portfolioCase = await prisma.staffPortfolioCase.findFirst({
    where: {
      id: caseId,
      staffId,
      status: StaffPortfolioStatus.PUBLISHED,
    },

    select: {
      id: true,
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

      service: {
        select: {
          id: true,
          name: true,
          description: true,
          price: true,
          durationMinutes: true,
          translations: true,
          status: true,
        },
      },

      images: {
        orderBy: [
          {
            sortOrder: "asc",
          },
          {
            createdAt: "asc",
          },
        ],

        select: {
          id: true,
          objectKey: true,
          isCover: true,
          sortOrder: true,
          createdAt: true,
        },
      },
    },
  });

  if (!portfolioCase) {
    throw new AppError("Published portfolio case not found", 404);
  }

  // =====================================================
  // 3. LOCALIZE CASE CONTENT
  // =====================================================

  const localizedCase = getLocalizedContent(
    portfolioCase.translations,
    language,
    {
      title: portfolioCase.title,
      description: portfolioCase.description ?? "",
    },
  );

  // =====================================================
  // 4. GENERATE SIGNED IMAGE URLS
  // =====================================================

  const images = await Promise.all(
    portfolioCase.images.map(async (image) => {
      const imageUrl = await uploadService.getImageUrl(image.objectKey);

      return {
        id: image.id,
        objectKey: image.objectKey,
        imageUrl,
        isCover: image.isCover,
        sortOrder: image.sortOrder,
        createdAt: image.createdAt,
      };
    }),
  );

  // =====================================================
  // 5. SELECT COVER IMAGE
  // =====================================================

  const coverImage = images.find((image) => image.isCover) ?? images[0] ?? null;

  // =====================================================
  // 6. LOCALIZE RELATED SERVICE
  // =====================================================

  let service = null;

  if (
    portfolioCase.service &&
    portfolioCase.service.status === ServiceStatus.ACTIVE
  ) {
    const localizedService = getLocalizedContent(
      portfolioCase.service.translations,
      language,
      {
        name: portfolioCase.service.name,
        description: portfolioCase.service.description ?? "",
      },
    );

    service = {
      id: portfolioCase.service.id,
      name: localizedService.name,
      description: localizedService.description || null,
      price: Number(portfolioCase.service.price),
      durationMinutes: portfolioCase.service.durationMinutes,
    };
  }

  // =====================================================
  // 7. STAFF AVATAR
  // =====================================================

  const avatarUrl = staff.avatarObjectKey
    ? await uploadService.getImageUrl(staff.avatarObjectKey)
    : null;

  // =====================================================
  // 8. FINAL RESPONSE
  // =====================================================

  return {
    id: portfolioCase.id,

    staff: {
      id: staff.id,
      name: staff.name,
      avatarObjectKey: staff.avatarObjectKey,
      avatarUrl,
    },

    title: localizedCase.title,
    description: localizedCase.description || null,

    tags: portfolioCase.tags,

    status: portfolioCase.status,
    sortOrder: portfolioCase.sortOrder,

    service,

    coverImage,

    images,

    imageCount: images.length,

    createdAt: portfolioCase.createdAt,
    updatedAt: portfolioCase.updatedAt,
  };
};

// =====================================================
// API 04 — GET ADMIN STAFF PORTFOLIO CASES
// =====================================================

const getAdminPortfolioCases = async (
  staffId: string,
  requester: {
    id: string;
    role: Role;
  },
  query: {
    page?: number | string;
    limit?: number | string;
    status?: StaffPortfolioStatus;
    branchId?: string;
  },
  language: Language = DEFAULT_LANGUAGE,
) => {
  // =====================================================
  // 1. AUTHORIZATION
  // =====================================================

  if (requester.role !== Role.BRAND_OWNER) {
    throw new AppError(
      "Only brand owners can access admin staff portfolios",
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

  if (
    query.status !== undefined &&
    !Object.values(StaffPortfolioStatus).includes(query.status)
  ) {
    throw new AppError("Invalid portfolio status", 400);
  }

  const skip = (page - 1) * limit;

  // =====================================================
  // 3. VERIFY STAFF
  // =====================================================

  const staff = await prisma.staff.findUnique({
    where: {
      id: staffId,
    },
    select: {
      id: true,
      name: true,
      status: true,
    },
  });

  if (!staff) {
    throw new AppError("Staff not found", 404);
  }

  // =====================================================
  // 4. VERIFY OPTIONAL BRANCH FILTER
  // =====================================================

  if (query.branchId !== undefined) {
    const branch = await prisma.branch.findUnique({
      where: {
        id: query.branchId,
      },
      select: {
        id: true,
      },
    });

    if (!branch) {
      throw new AppError("Branch not found", 404);
    }
  }

  // =====================================================
  // 5. BUILD FILTER
  // =====================================================

  const where: Prisma.StaffPortfolioCaseWhereInput = {
    staffId,

    ...(query.status !== undefined ? { status: query.status } : {}),

    ...(query.branchId !== undefined ? { branchId: query.branchId } : {}),
  };

  // =====================================================
  // 6. FETCH CASES + TOTAL COUNT
  // =====================================================

  const [cases, total] = await Promise.all([
    prisma.staffPortfolioCase.findMany({
      where,
      skip,
      take: limit,

      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],

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
        showInBranchPortfolio: true,

        createdAt: true,
        updatedAt: true,

        branch: {
          select: {
            id: true,
            name: true,
            translations: true,
            status: true,
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
      where,
    }),
  ]);

  // =====================================================
  // 7. LOCALIZE CASES + GENERATE IMAGE URLS
  // =====================================================

  const items = await Promise.all(
    cases.map(async (portfolioCase) => {
      const localizedCase = getLocalizedContent(
        portfolioCase.translations,
        language,
        {
          title: portfolioCase.title,
          description: portfolioCase.description ?? "",
        },
      );

      const images = await Promise.all(
        portfolioCase.images.map(async (image) => ({
          id: image.id,
          objectKey: image.objectKey,
          imageUrl: await uploadService.getImageUrl(image.objectKey),
          isCover: image.isCover,
          sortOrder: image.sortOrder,
        })),
      );

      const coverImage =
        images.find((image) => image.isCover) ?? images[0] ?? null;

      // =================================================
      // LOCALIZE SERVICE
      // =================================================

      const localizedService = portfolioCase.service
        ? getLocalizedContent(portfolioCase.service.translations, language, {
            name: portfolioCase.service.name,
          })
        : null;

      // =================================================
      // LOCALIZE BRANCH
      // =================================================

      const localizedBranch = portfolioCase.branch
        ? getLocalizedContent(portfolioCase.branch.translations, language, {
            name: portfolioCase.branch.name,
          })
        : null;

      // =================================================
      // FINAL ITEM
      // =================================================

      return {
        id: portfolioCase.id,
        staffId: portfolioCase.staffId,

        // NEW: Branch association
        branchId: portfolioCase.branchId,

        serviceId: portfolioCase.serviceId,

        title: localizedCase.title,
        description: localizedCase.description || null,

        tags: portfolioCase.tags,
        translations: portfolioCase.translations,

        status: portfolioCase.status,
        sortOrder: portfolioCase.sortOrder,

        // NEW: Branch gallery visibility
        showInBranchPortfolio: portfolioCase.showInBranchPortfolio,

        // NEW: Branch details
        branch: portfolioCase.branch
          ? {
              id: portfolioCase.branch.id,
              name: localizedBranch!.name,
              status: portfolioCase.branch.status,
            }
          : null,

        // Existing service details
        service: portfolioCase.service
          ? {
              id: portfolioCase.service.id,
              name: localizedService!.name,
            }
          : null,

        coverImage,
        images,
        imageCount: images.length,

        createdAt: portfolioCase.createdAt,
        updatedAt: portfolioCase.updatedAt,
      };
    }),
  );

  // =====================================================
  // 8. PAGINATION
  // =====================================================

  const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

  // =====================================================
  // 9. FINAL RESPONSE
  // =====================================================

  return {
    staff: {
      id: staff.id,
      name: staff.name,
      status: staff.status,
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

// =====================================================
// API 05 — CREATE STAFF PORTFOLIO CASE
// =====================================================

const createPortfolioCase = async (
  staffId: string,
  requester: {
    id: string;
    role: Role;
  },
  payload: {
    title: string;
    description?: string | null;
    branchId?: string | null;
    serviceId?: string | null;
    tags?: string[];
    translations?: {
      en?: {
        title?: string;
        description?: string;
      };
      "zh-CN"?: {
        title?: string;
        description?: string;
      };
      "zh-HK"?: {
        title?: string;
        description?: string;
      };
    };
    status?: StaffPortfolioStatus;
    sortOrder?: number;
  },
) => {
  // =====================================================
  // 1. AUTHORIZATION
  // =====================================================

  if (requester.role !== Role.BRAND_OWNER) {
    throw new AppError(
      "Only brand owners can create staff portfolio cases",
      403,
    );
  }

  // =====================================================
  // 2. VERIFY STAFF + ASSIGNMENTS
  // =====================================================

  const staff = await prisma.staff.findUnique({
    where: {
      id: staffId,
    },
    select: {
      id: true,
      name: true,
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

  const staffBranchIds = new Set(staff.branches.map((item) => item.branchId));

  // =====================================================
  // 3. VALIDATE BRANCH
  // =====================================================

  const branchId = payload.branchId ?? null;

  if (branchId !== null) {
    if (!staffBranchIds.has(branchId)) {
      throw new AppError("Branch is not assigned to this staff", 400);
    }

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
      throw new AppError("Branch is not active", 400);
    }
  }

  // =====================================================
  // 4. VALIDATE RELATED SERVICE
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

    const isAssignedToStaff = staff.services.some(
      (item) => item.serviceId === payload.serviceId,
    );

    if (!isAssignedToStaff) {
      throw new AppError("Service is not assigned to this staff", 400);
    }

    const serviceBranchIds = new Set(
      service.branches.map((item) => item.branchId),
    );

    if (branchId !== null) {
      // When a specific branch is selected, the service
      // must be available in that exact branch.
      if (!serviceBranchIds.has(branchId)) {
        throw new AppError(
          "Service is not available in the selected branch",
          400,
        );
      }
    } else {
      // Preserve the existing behavior when branchId
      // is omitted: staff and service must share a branch.
      const hasCommonBranch = [...staffBranchIds].some((id) =>
        serviceBranchIds.has(id),
      );

      if (!hasCommonBranch) {
        throw new AppError(
          "Service is not available in any assigned staff branch",
          400,
        );
      }
    }
  }

  // =====================================================
  // 5. CREATE STAFF PORTFOLIO CASE
  // =====================================================

  const portfolioCase = await prisma.staffPortfolioCase.create({
    data: {
      staffId,
      branchId,
      serviceId: payload.serviceId ?? null,

      title: payload.title.trim(),
      description: payload.description?.trim() || null,

      tags: payload.tags ?? [],

      translations: payload.translations
        ? (payload.translations as Prisma.InputJsonValue)
        : Prisma.JsonNull,

      status: payload.status ?? StaffPortfolioStatus.DRAFT,
      sortOrder: payload.sortOrder ?? 0,

      // Manager-controlled field; not accepted from payload.
      showInBranchPortfolio: true,
    },

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
      showInBranchPortfolio: true,

      createdAt: true,
      updatedAt: true,
    },
  });

  // =====================================================
  // 6. FINAL RESPONSE
  // =====================================================

  return {
    ...portfolioCase,
    images: [],
    imageCount: 0,
  };
};

// =====================================================
// API 06 — UPDATE STAFF PORTFOLIO CASE
// BRAND_OWNER ONLY
// =====================================================

const updatePortfolioCase = async (
  staffId: string,
  caseId: string,
  requester: {
    id: string;
    role: Role;
  },
  payload: {
    title?: string;
    description?: string | null;
    branchId?: string | null;
    serviceId?: string | null;
    tags?: string[];
    translations?: {
      en?: {
        title?: string;
        description?: string;
      };
      "zh-CN"?: {
        title?: string;
        description?: string;
      };
      "zh-HK"?: {
        title?: string;
        description?: string;
      };
    } | null;
    status?: StaffPortfolioStatus;
    sortOrder?: number;
  },
) => {
  // =====================================================
  // 1. AUTHORIZATION
  // =====================================================

  if (requester.role !== Role.BRAND_OWNER) {
    throw new AppError(
      "Only brand owners can update staff portfolio cases",
      403,
    );
  }

  // =====================================================
  // 2. VERIFY STAFF + ASSIGNMENTS
  // =====================================================

  const staff = await prisma.staff.findUnique({
    where: {
      id: staffId,
    },
    select: {
      id: true,
      name: true,

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

  const staffBranchIds = new Set(staff.branches.map((item) => item.branchId));

  const staffServiceIds = new Set(staff.services.map((item) => item.serviceId));

  // =====================================================
  // 3. VERIFY EXISTING PORTFOLIO CASE
  // =====================================================

  const existingCase = await prisma.staffPortfolioCase.findFirst({
    where: {
      id: caseId,
      staffId,
    },
    select: {
      id: true,
      branchId: true,
      serviceId: true,
      status: true,
      showInBranchPortfolio: true,
    },
  });

  if (!existingCase) {
    throw new AppError("Staff portfolio case not found", 404);
  }

  // =====================================================
  // 4. RESOLVE EFFECTIVE VALUES
  // =====================================================

  const effectiveBranchId =
    payload.branchId !== undefined ? payload.branchId : existingCase.branchId;

  const effectiveServiceId =
    payload.serviceId !== undefined
      ? payload.serviceId
      : existingCase.serviceId;

  const branchChanged =
    payload.branchId !== undefined &&
    payload.branchId !== existingCase.branchId;

  const serviceChanged =
    payload.serviceId !== undefined &&
    payload.serviceId !== existingCase.serviceId;

  // =====================================================
  // 5. VALIDATE BRANCH
  // =====================================================

  if (branchChanged && effectiveBranchId !== null) {
    if (!staffBranchIds.has(effectiveBranchId)) {
      throw new AppError("Branch is not assigned to this staff", 400);
    }

    const branch = await prisma.branch.findUnique({
      where: {
        id: effectiveBranchId,
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
      throw new AppError("Branch is not active", 400);
    }
  }

  // =====================================================
  // 6. VALIDATE SERVICE + BRANCH COMPATIBILITY
  // =====================================================

  if (effectiveServiceId !== null && (branchChanged || serviceChanged)) {
    const service = await prisma.service.findUnique({
      where: {
        id: effectiveServiceId,
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

    if (!service) {
      throw new AppError("Service not found", 404);
    }

    if (service.status !== ServiceStatus.ACTIVE) {
      throw new AppError("Service is not active", 400);
    }

    if (!staffServiceIds.has(effectiveServiceId)) {
      throw new AppError("Service is not assigned to this staff", 400);
    }

    const serviceBranchIds = new Set(
      service.branches.map((item) => item.branchId),
    );

    if (effectiveBranchId !== null) {
      // Validate selected branch.
      if (!staffBranchIds.has(effectiveBranchId)) {
        throw new AppError("Staff is not assigned to the selected branch", 400);
      }

      // Service must be available at the selected branch.
      if (!serviceBranchIds.has(effectiveBranchId)) {
        throw new AppError(
          "Service is not available in the selected branch",
          400,
        );
      }
    } else {
      // Preserve existing behavior for cases without branchId.
      const hasCommonBranch = [...staffBranchIds].some((branchId) =>
        serviceBranchIds.has(branchId),
      );

      if (!hasCommonBranch) {
        throw new AppError(
          "Service is not available in any assigned staff branch",
          400,
        );
      }
    }
  }

  // =====================================================
  // 7. BUILD PARTIAL UPDATE DATA
  // =====================================================

  const updateData: Prisma.StaffPortfolioCaseUncheckedUpdateInput = {};

  if (payload.title !== undefined) {
    updateData.title = payload.title.trim();
  }

  if (payload.description !== undefined) {
    updateData.description =
      payload.description === null ? null : payload.description.trim() || null;
  }

  if (payload.tags !== undefined) {
    updateData.tags = payload.tags;
  }

  if (payload.translations !== undefined) {
    updateData.translations =
      payload.translations === null
        ? Prisma.JsonNull
        : (payload.translations as Prisma.InputJsonValue);
  }

  if (payload.status !== undefined) {
    updateData.status = payload.status;
  }

  if (payload.sortOrder !== undefined) {
    updateData.sortOrder = payload.sortOrder;
  }

  // =====================================================
  // 8. UPDATE BRANCH ID
  // =====================================================

  if (payload.branchId !== undefined) {
    updateData.branchId = payload.branchId;
  }

  // =====================================================
  // 9. UPDATE SERVICE ID
  // =====================================================

  if (payload.serviceId !== undefined) {
    updateData.serviceId = payload.serviceId;
  }

  // showInBranchPortfolio is intentionally not updated here.
  // It will be controlled by a dedicated manager API.

  // =====================================================
  // 10. UPDATE PORTFOLIO CASE
  // =====================================================

  const updatedCase = await prisma.staffPortfolioCase.update({
    where: {
      id: existingCase.id,
    },

    data: updateData,

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
      showInBranchPortfolio: true,

      createdAt: true,
      updatedAt: true,

      images: {
        orderBy: [
          {
            sortOrder: "asc",
          },
          {
            createdAt: "asc",
          },
        ],

        select: {
          id: true,
          objectKey: true,
          isCover: true,
          sortOrder: true,
        },
      },
    },
  });

  // =====================================================
  // 11. GENERATE SIGNED R2 IMAGE URLS
  // =====================================================

  const images = await Promise.all(
    updatedCase.images.map(async (image) => ({
      id: image.id,
      objectKey: image.objectKey,

      imageUrl: await uploadService.getImageUrl(image.objectKey),

      isCover: image.isCover,
      sortOrder: image.sortOrder,
    })),
  );

  // =====================================================
  // 12. SELECT COVER IMAGE
  // =====================================================

  const coverImage = images.find((image) => image.isCover) ?? images[0] ?? null;

  // =====================================================
  // 13. FINAL RESPONSE
  // =====================================================

  return {
    id: updatedCase.id,
    staffId: updatedCase.staffId,

    branchId: updatedCase.branchId,
    serviceId: updatedCase.serviceId,

    title: updatedCase.title,
    description: updatedCase.description,

    tags: updatedCase.tags,
    translations: updatedCase.translations,

    status: updatedCase.status,
    sortOrder: updatedCase.sortOrder,

    showInBranchPortfolio: updatedCase.showInBranchPortfolio,

    coverImage,
    images,
    imageCount: images.length,

    createdAt: updatedCase.createdAt,
    updatedAt: updatedCase.updatedAt,
  };
};

// =====================================================
// API 07 — ADD MULTIPLE PORTFOLIO IMAGES
// BRAND_OWNER ONLY
// =====================================================

const addPortfolioImages = async (
  staffId: string,
  caseId: string,
  requester: {
    id: string;
    role: Role;
  },
  payload: {
    images: {
      objectKey: string;
      isCover?: boolean;
      sortOrder?: number;
    }[];
  },
) => {
  // =====================================================
  // 1. AUTHORIZATION
  // =====================================================

  if (requester.role !== Role.BRAND_OWNER) {
    throw new AppError("Only brand owners can manage portfolio images", 403);
  }

  // =====================================================
  // 2. VALIDATE INPUT
  // =====================================================

  if (
    !Array.isArray(payload.images) ||
    payload.images.length === 0 ||
    payload.images.length > 20
  ) {
    throw new AppError("You must provide between 1 and 20 images", 400);
  }

  const objectKeys = payload.images.map((image) => image.objectKey);

  if (new Set(objectKeys).size !== objectKeys.length) {
    throw new AppError("Duplicate image object keys are not allowed", 400);
  }

  if (payload.images.filter((image) => image.isCover === true).length > 1) {
    throw new AppError("Only one image can be selected as cover", 400);
  }

  // =====================================================
  // 3. VERIFY STAFF
  // =====================================================

  const staff = await prisma.staff.findUnique({
    where: {
      id: staffId,
    },
    select: {
      id: true,
    },
  });

  if (!staff) {
    throw new AppError("Staff not found", 404);
  }

  // =====================================================
  // 4. VERIFY PORTFOLIO CASE
  // =====================================================

  const portfolioCase = await prisma.staffPortfolioCase.findFirst({
    where: {
      id: caseId,
      staffId,
    },
    select: {
      id: true,
    },
  });

  if (!portfolioCase) {
    throw new AppError("Staff portfolio case not found", 404);
  }

  // =====================================================
  // 5. VALIDATE IMAGE KEYS
  // =====================================================

  const existingImages = await prisma.staffPortfolioCaseImage.findMany({
    where: {
      caseId,
    },
    select: {
      objectKey: true,
      isCover: true,
      sortOrder: true,
    },
    orderBy: {
      sortOrder: "desc",
    },
  });

  const existingKeys = new Set(existingImages.map((image) => image.objectKey));

  for (const objectKey of objectKeys) {
    if (!objectKey.trim()) {
      throw new AppError("Image objectKey cannot be empty", 400);
    }

    if (existingKeys.has(objectKey)) {
      throw new AppError(
        "Image is already attached to this portfolio case",
        400,
      );
    }
  }

  // =====================================================
  // 6. DETERMINE COVER IMAGE
  // =====================================================

  const requestedCoverIndex = payload.images.findIndex(
    (image) => image.isCover === true,
  );

  const hasExistingCover = existingImages.some((image) => image.isCover);

  // If no cover exists, first new image becomes cover.
  const coverIndex =
    requestedCoverIndex >= 0 ? requestedCoverIndex : !hasExistingCover ? 0 : -1;

  const nextSortOrder =
    existingImages.length > 0 ? existingImages[0].sortOrder + 1 : 0;

  // =====================================================
  // 7. SAVE IMAGES IN DATABASE
  // =====================================================

  await prisma.$transaction(async (tx) => {
    // If a new cover was explicitly selected,
    // remove cover flag from previous images.
    if (requestedCoverIndex >= 0) {
      await tx.staffPortfolioCaseImage.updateMany({
        where: {
          caseId,
          isCover: true,
        },
        data: {
          isCover: false,
        },
      });
    }

    for (const [index, image] of payload.images.entries()) {
      await tx.staffPortfolioCaseImage.create({
        data: {
          caseId,
          objectKey: image.objectKey.trim(),
          isCover: index === coverIndex,
          sortOrder: image.sortOrder ?? nextSortOrder + index,
        },
      });
    }
  });

  // =====================================================
  // 8. FETCH UPDATED IMAGES
  // =====================================================

  const savedImages = await prisma.staffPortfolioCaseImage.findMany({
    where: {
      caseId,
    },
    orderBy: [
      {
        sortOrder: "asc",
      },
      {
        createdAt: "asc",
      },
    ],
    select: {
      id: true,
      objectKey: true,
      isCover: true,
      sortOrder: true,
      createdAt: true,
    },
  });

  // =====================================================
  // 9. GENERATE SIGNED R2 URLS
  // =====================================================

  const images = await Promise.all(
    savedImages.map(async (image) => ({
      id: image.id,
      objectKey: image.objectKey,
      imageUrl: await uploadService.getImageUrl(image.objectKey),
      isCover: image.isCover,
      sortOrder: image.sortOrder,
      createdAt: image.createdAt,
    })),
  );

  const coverImage = images.find((image) => image.isCover) ?? images[0] ?? null;

  // =====================================================
  // 10. FINAL RESPONSE
  // =====================================================

  return {
    caseId,
    staffId,
    coverImage,
    images,
    imageCount: images.length,
  };
};

// =====================================================
// API 08 — REORDER PORTFOLIO IMAGES / SET COVER
// BRAND_OWNER ONLY
// =====================================================

const reorderPortfolioImages = async (
  staffId: string,
  caseId: string,
  requester: {
    id: string;
    role: Role;
  },
  payload: {
    images: {
      imageId: string;
      sortOrder: number;
      isCover: boolean;
    }[];
  },
) => {
  // =====================================================
  // 1. AUTHORIZATION
  // =====================================================

  if (requester.role !== Role.BRAND_OWNER) {
    throw new AppError("Only brand owners can manage portfolio images", 403);
  }

  // =====================================================
  // 2. VALIDATE PAYLOAD
  // =====================================================

  if (!Array.isArray(payload.images) || payload.images.length === 0) {
    throw new AppError("At least one portfolio image is required", 400);
  }

  const imageIds = payload.images.map((image) => image.imageId);

  if (new Set(imageIds).size !== imageIds.length) {
    throw new AppError("Duplicate image IDs are not allowed", 400);
  }

  const sortOrders = payload.images.map((image) => image.sortOrder);

  if (sortOrders.some((order) => !Number.isInteger(order) || order < 0)) {
    throw new AppError("sortOrder must be a non-negative integer", 400);
  }

  if (new Set(sortOrders).size !== sortOrders.length) {
    throw new AppError("Duplicate sortOrder values are not allowed", 400);
  }

  const coverImages = payload.images.filter((image) => image.isCover === true);

  if (coverImages.length !== 1) {
    throw new AppError("Exactly one image must be selected as cover", 400);
  }

  // =====================================================
  // 3. VERIFY STAFF
  // =====================================================

  const staff = await prisma.staff.findUnique({
    where: {
      id: staffId,
    },
    select: {
      id: true,
    },
  });

  if (!staff) {
    throw new AppError("Staff not found", 404);
  }

  // =====================================================
  // 4. TRANSACTION: VERIFY AND UPDATE IMAGES
  // =====================================================

  await prisma.$transaction(
    async (tx) => {
      const portfolioCase = await tx.staffPortfolioCase.findFirst({
        where: {
          id: caseId,
          staffId,
        },
        select: {
          id: true,
          images: {
            select: {
              id: true,
            },
          },
        },
      });

      if (!portfolioCase) {
        throw new AppError("Staff portfolio case not found", 404);
      }

      // All images must be included.
      if (portfolioCase.images.length !== payload.images.length) {
        throw new AppError(
          "You must provide all existing portfolio images",
          400,
        );
      }

      const existingImageIds = new Set(
        portfolioCase.images.map((image) => image.id),
      );

      for (const imageId of imageIds) {
        if (!existingImageIds.has(imageId)) {
          throw new AppError(
            "Image does not belong to this portfolio case",
            400,
          );
        }
      }

      // Clear previous cover selection.
      await tx.staffPortfolioCaseImage.updateMany({
        where: {
          caseId,
        },
        data: {
          isCover: false,
        },
      });

      // Update each image's order and cover flag.
      for (const image of payload.images) {
        await tx.staffPortfolioCaseImage.update({
          where: {
            id: image.imageId,
          },
          data: {
            sortOrder: image.sortOrder,
            isCover: image.isCover,
          },
        });
      }
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    },
  );

  // =====================================================
  // 5. FETCH UPDATED IMAGES
  // =====================================================

  const savedImages = await prisma.staffPortfolioCaseImage.findMany({
    where: {
      caseId,
    },
    orderBy: [
      {
        sortOrder: "asc",
      },
      {
        createdAt: "asc",
      },
    ],
    select: {
      id: true,
      objectKey: true,
      isCover: true,
      sortOrder: true,
      createdAt: true,
    },
  });

  // =====================================================
  // 6. GENERATE SIGNED R2 URLS
  // =====================================================

  const images = await Promise.all(
    savedImages.map(async (image) => ({
      id: image.id,
      objectKey: image.objectKey,
      imageUrl: await uploadService.getImageUrl(image.objectKey),
      isCover: image.isCover,
      sortOrder: image.sortOrder,
      createdAt: image.createdAt,
    })),
  );

  const coverImage = images.find((image) => image.isCover) ?? null;

  // =====================================================
  // 7. FINAL RESPONSE
  // =====================================================

  return {
    staffId,
    caseId,
    coverImage,
    images,
    imageCount: images.length,
  };
};

// =====================================================
// API 09 — DELETE STAFF PORTFOLIO IMAGE
// BRAND_OWNER ONLY
// =====================================================

const deletePortfolioImage = async (
  staffId: string,
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
    throw new AppError("Only brand owners can delete portfolio images", 403);
  }

  // =====================================================
  // 2. VERIFY STAFF
  // =====================================================

  const staff = await prisma.staff.findUnique({
    where: {
      id: staffId,
    },
    select: {
      id: true,
    },
  });

  if (!staff) {
    throw new AppError("Staff not found", 404);
  }

  // =====================================================
  // 3. DELETE IMAGE AND REORGANIZE GALLERY
  // =====================================================

  const result = await prisma.$transaction(
    async (tx) => {
      // Verify portfolio case belongs to staff.
      const portfolioCase = await tx.staffPortfolioCase.findFirst({
        where: {
          id: caseId,
          staffId,
        },
        select: {
          id: true,
        },
      });

      if (!portfolioCase) {
        throw new AppError("Staff portfolio case not found", 404);
      }

      // Verify image belongs to this case.
      const existingImage = await tx.staffPortfolioCaseImage.findFirst({
        where: {
          id: imageId,
          caseId,
        },
        select: {
          id: true,
          objectKey: true,
          isCover: true,
        },
      });

      if (!existingImage) {
        throw new AppError("Portfolio image not found", 404);
      }

      // Delete only the database record.
      await tx.staffPortfolioCaseImage.delete({
        where: {
          id: existingImage.id,
        },
      });

      // Fetch remaining images in current order.
      const remainingImages = await tx.staffPortfolioCaseImage.findMany({
        where: {
          caseId,
        },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          isCover: true,
        },
      });

      // Determine which image should be cover.
      // Preserve existing cover if it still exists.
      // Otherwise, select the first remaining image.
      const currentCover = remainingImages.find((image) => image.isCover);

      const newCoverId = currentCover?.id ?? remainingImages[0]?.id ?? null;

      // Clear existing cover flags before assigning one.
      await tx.staffPortfolioCaseImage.updateMany({
        where: {
          caseId,
          isCover: true,
        },
        data: {
          isCover: false,
        },
      });

      // Normalize sortOrder and cover flags.
      for (const [index, image] of remainingImages.entries()) {
        await tx.staffPortfolioCaseImage.update({
          where: {
            id: image.id,
          },
          data: {
            sortOrder: index,
            isCover: image.id === newCoverId,
          },
        });
      }

      return {
        deletedImageId: existingImage.id,
        deletedObjectKey: existingImage.objectKey,
        wasCover: existingImage.isCover,
      };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    },
  );

  // =====================================================
  // 4. FETCH UPDATED GALLERY
  // =====================================================

  const savedImages = await prisma.staffPortfolioCaseImage.findMany({
    where: {
      caseId,
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      objectKey: true,
      isCover: true,
      sortOrder: true,
      createdAt: true,
    },
  });

  // =====================================================
  // 5. GENERATE SIGNED IMAGE URLS
  // =====================================================

  const images = await Promise.all(
    savedImages.map(async (image) => ({
      id: image.id,
      objectKey: image.objectKey,
      imageUrl: await uploadService.getImageUrl(image.objectKey),
      isCover: image.isCover,
      sortOrder: image.sortOrder,
      createdAt: image.createdAt,
    })),
  );

  const coverImage = images.find((image) => image.isCover) ?? null;

  // =====================================================
  // 6. FINAL RESPONSE
  // =====================================================

  return {
    staffId,
    caseId,

    deletedImage: {
      id: result.deletedImageId,
      objectKey: result.deletedObjectKey,
      wasCover: result.wasCover,
    },

    coverImage,
    images,
    imageCount: images.length,
  };
};

// =====================================================
// API 10 — DELETE STAFF PORTFOLIO CASE
// BRAND_OWNER ONLY
// =====================================================

const deletePortfolioCase = async (
  staffId: string,
  caseId: string,
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
      "Only brand owners can delete staff portfolio cases",
      403,
    );
  }

  // =====================================================
  // 2. VERIFY STAFF
  // =====================================================

  const staff = await prisma.staff.findUnique({
    where: {
      id: staffId,
    },
    select: {
      id: true,
      name: true,
    },
  });

  if (!staff) {
    throw new AppError("Staff not found", 404);
  }

  // =====================================================
  // 3. VERIFY PORTFOLIO CASE
  // =====================================================

  const portfolioCase = await prisma.staffPortfolioCase.findFirst({
    where: {
      id: caseId,
      staffId,
    },

    select: {
      id: true,
      staffId: true,
      title: true,
      status: true,

      images: {
        select: {
          id: true,
          objectKey: true,
        },
      },
    },
  });

  if (!portfolioCase) {
    throw new AppError("Staff portfolio case not found", 404);
  }

  // =====================================================
  // 4. DELETE CASE
  // =====================================================

  // Delete only when caseId and staffId both match.
  // Prisma cascade removes associated image records.

  const deleted = await prisma.staffPortfolioCase.deleteMany({
    where: {
      id: caseId,
      staffId,
    },
  });

  if (deleted.count === 0) {
    throw new AppError("Staff portfolio case not found", 404);
  }

  // =====================================================
  // 5. FINAL RESPONSE
  // =====================================================

  return {
    id: portfolioCase.id,
    staffId: portfolioCase.staffId,
    title: portfolioCase.title,
    previousStatus: portfolioCase.status,

    deleted: true,

    deletedImageCount: portfolioCase.images.length,

    deletedImageObjectKeys: portfolioCase.images.map(
      (image) => image.objectKey,
    ),

    storageCleanup: "NOT_PERFORMED",
  };
};

const updateBranchPortfolioVisibility = async (
  staffId: string,
  caseId: string,
  requester: {
    id: string;
    role: Role;
  },
  payload: {
    showInBranchPortfolio: boolean;
  },
) => {
  // =====================================================
  // 1. ONLY BRAND OWNER ACCESS
  // =====================================================

  if (requester.role !== Role.BRAND_OWNER) {
    throw new AppError(
      "Only brand owners can manage branch portfolio visibility",
      403,
    );
  }

  // =====================================================
  // 2. VERIFY PORTFOLIO CASE
  // =====================================================

  const portfolioCase = await prisma.staffPortfolioCase.findFirst({
    where: {
      id: caseId,
      staffId,
    },
    select: {
      id: true,
      staffId: true,
      branchId: true,
      status: true,
      showInBranchPortfolio: true,
    },
  });

  if (!portfolioCase) {
    throw new AppError("Staff portfolio case not found", 404);
  }

  // =====================================================
  // 3. REQUIRE BRANCH ASSOCIATION
  // =====================================================

  if (!portfolioCase.branchId) {
    throw new AppError(
      "This staff portfolio case is not associated with a branch",
      400,
    );
  }

  // =====================================================
  // 4. UPDATE BRANCH PORTFOLIO VISIBILITY
  // =====================================================

  const updatedCase = await prisma.staffPortfolioCase.update({
    where: {
      id: portfolioCase.id,
    },
    data: {
      showInBranchPortfolio: payload.showInBranchPortfolio,
    },
    select: {
      id: true,
      staffId: true,
      branchId: true,
      status: true,
      showInBranchPortfolio: true,
      updatedAt: true,
    },
  });

  // =====================================================
  // 5. FINAL RESPONSE
  // =====================================================

  return updatedCase;
};

export const staffPortfolioService = {
  getStaffPortfolio,
  getPublishedPortfolioCases,
  getPublishedPortfolioCaseById,
  getAdminPortfolioCases,
  createPortfolioCase,
  updatePortfolioCase,
  addPortfolioImages,
  reorderPortfolioImages,
  deletePortfolioImage,
  deletePortfolioCase,
  updateBranchPortfolioVisibility,
};
