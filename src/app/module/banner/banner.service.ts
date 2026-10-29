import { Prisma } from "../../../../generated/prisma/client.js";
import {
  BannerMediaType,
  BannerScope,
  BannerStatus,
  Role,
} from "../../../../generated/prisma/enums.js";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../utils/app-error.js";
import { uploadService } from "../upload/upload.service.js";
import {
  IAdminBannerQuery,
  IBannerActor,
  ICreateBannerPayload,
  IGetActiveBannersQuery,
  IUpdateBannerMediaOrderPayload,
  IUpdateBannerPayload,
} from "./banner.interface.js";

const createBanner = async (
  payload: ICreateBannerPayload,
  actor: IBannerActor,
) => {
  // ===================================================
  // 1. ROLE AUTHORIZATION
  // ===================================================

  if (actor.role !== Role.BRAND_OWNER && actor.role !== Role.BRANCH_MANAGER) {
    throw new AppError("BANNER_CREATE_NOT_ALLOWED", 403);
  }

  // ===================================================
  // 2. VERIFY BRAND
  // ===================================================

  const brand = await prisma.brand.findUnique({
    where: {
      id: actor.brandId,
    },
    select: {
      id: true,
    },
  });

  if (!brand) {
    throw new AppError("BRAND_NOT_FOUND", 404);
  }

  // ===================================================
  // 3. NORMALIZE INPUT
  // ===================================================

  const scope = payload.scope ?? BannerScope.SELECTED_BRANCHES;

  const status = payload.status ?? BannerStatus.DRAFT;

  const branchIds = payload.branchIds ?? [];

  const uniqueBranchIds = [...new Set(branchIds)];

  // ===================================================
  // 4. VALIDATE SCOPE
  // ===================================================

  if (scope === BannerScope.BRAND_WIDE && uniqueBranchIds.length > 0) {
    throw new AppError(
      "Brand-wide banners cannot have branch assignments",
      400,
    );
  }

  if (scope === BannerScope.SELECTED_BRANCHES && uniqueBranchIds.length === 0) {
    throw new AppError("At least one branch is required", 400);
  }

  // ===================================================
  // 5. BRANCH MANAGER SCOPE RESTRICTION
  // ===================================================

  if (actor.role === Role.BRANCH_MANAGER && scope === BannerScope.BRAND_WIDE) {
    throw new AppError("Branch managers cannot create brand-wide banners", 403);
  }

  // ===================================================
  // 6. VERIFY SELECTED BRANCHES
  // ===================================================

  if (scope === BannerScope.SELECTED_BRANCHES) {
    const branches = await prisma.branch.findMany({
      where: {
        id: {
          in: uniqueBranchIds,
        },
      },
      select: {
        id: true,
      },
    });

    if (branches.length !== uniqueBranchIds.length) {
      throw new AppError("One or more selected branches were not found", 400);
    }

    // =================================================
    // 7. BRANCH MANAGER AUTHORIZATION
    // =================================================

    if (actor.role === Role.BRANCH_MANAGER) {
      const managerBranches = await prisma.branchManagerBranch.findMany({
        where: {
          userId: actor.userId,
          branchId: {
            in: uniqueBranchIds,
          },
        },
        select: {
          branchId: true,
        },
      });

      if (managerBranches.length !== uniqueBranchIds.length) {
        throw new AppError(
          "You can only create banners for your assigned branches",
          403,
        );
      }
    }
  }

  // ===================================================
  // 8. VALIDATE SCHEDULE
  // ===================================================

  const startAt = payload.startAt ? new Date(payload.startAt) : null;

  const endAt = payload.endAt ? new Date(payload.endAt) : null;

  if (
    (startAt && Number.isNaN(startAt.getTime())) ||
    (endAt && Number.isNaN(endAt.getTime()))
  ) {
    throw new AppError("INVALID_BANNER_SCHEDULE", 400);
  }

  if (startAt && endAt && endAt.getTime() <= startAt.getTime()) {
    throw new AppError("Banner end date must be later than start date", 400);
  }

  // ===================================================
  // 9. CREATE BANNER
  // ===================================================

  // New banners must start as DRAFT because media is
  // uploaded and attached after banner creation.
  if (status === BannerStatus.ACTIVE) {
    throw new AppError(
      "Create the banner as DRAFT, attach media, then activate it",
      400,
    );
  }

  const banner = await prisma.banner.create({
    data: {
      brandId: actor.brandId,

      title: payload.title.trim(),

      description: payload.description?.trim() || null,

      scope,

      status,

      sortOrder: payload.sortOrder ?? 0,

      startAt,

      endAt,

      ...(scope === BannerScope.SELECTED_BRANCHES
        ? {
            branches: {
              create: uniqueBranchIds.map((branchId) => ({
                branch: {
                  connect: {
                    id: branchId,
                  },
                },
              })),
            },
          }
        : {}),
    },

    include: {
      branches: {
        select: {
          branchId: true,
        },
      },

      media: {
        orderBy: {
          sortOrder: "asc",
        },
      },
    },
  });

  // ===================================================
  // 10. RESPONSE
  // ===================================================

  return {
    id: banner.id,
    brandId: banner.brandId,
    title: banner.title,
    description: banner.description,
    scope: banner.scope,
    status: banner.status,
    sortOrder: banner.sortOrder,
    startAt: banner.startAt,
    endAt: banner.endAt,
    branchIds: banner.branches.map((item) => item.branchId),
    media: banner.media,
    createdAt: banner.createdAt,
    updatedAt: banner.updatedAt,
  };
};

const attachBannerMedia = async (
  bannerId: string,
  payload: {
    objectKey: string;
    mediaType: BannerMediaType;
    sortOrder?: number;
  },
  actor: IBannerActor,
) => {
  // ===================================================
  // 1. ROLE AUTHORIZATION
  // ===================================================

  if (actor.role !== Role.BRAND_OWNER && actor.role !== Role.BRANCH_MANAGER) {
    throw new AppError("BANNER_MEDIA_ATTACH_NOT_ALLOWED", 403);
  }

  // ===================================================
  // 2. VERIFY BANNER
  // ===================================================

  const banner = await prisma.banner.findUnique({
    where: {
      id: bannerId,
    },
    select: {
      id: true,
      brandId: true,
      scope: true,
      branches: {
        select: {
          branchId: true,
        },
      },
    },
  });

  if (!banner) {
    throw new AppError("BANNER_NOT_FOUND", 404);
  }

  // ===================================================
  // 3. VERIFY BRAND ACCESS
  // ===================================================

  if (banner.brandId !== actor.brandId) {
    throw new AppError("BANNER_MEDIA_ATTACH_NOT_ALLOWED", 403);
  }

  // ===================================================
  // 4. BRANCH MANAGER AUTHORIZATION
  // ===================================================

  if (actor.role === Role.BRANCH_MANAGER) {
    if (banner.scope !== BannerScope.SELECTED_BRANCHES) {
      throw new AppError("BANNER_MEDIA_ATTACH_NOT_ALLOWED", 403);
    }

    const managerBranches = await prisma.branchManagerBranch.findMany({
      where: {
        userId: actor.userId,
      },
      select: {
        branchId: true,
      },
    });

    const allowedBranchIds = new Set(
      managerBranches.map((item) => item.branchId),
    );

    const hasAccess =
      banner.branches.length > 0 &&
      banner.branches.every((item) => allowedBranchIds.has(item.branchId));

    if (!hasAccess) {
      throw new AppError("BANNER_MEDIA_ATTACH_NOT_ALLOWED", 403);
    }
  }

  // ===================================================
  // 5. VALIDATE OBJECT KEY
  // ===================================================

  const expectedPrefix = `banners/${bannerId}/`;

  if (!payload.objectKey.startsWith(expectedPrefix)) {
    throw new AppError("INVALID_BANNER_MEDIA_OBJECT_KEY", 400);
  }

  const parts = payload.objectKey.split("/");

  if (parts.length !== 3 || !parts[2]) {
    throw new AppError("INVALID_BANNER_MEDIA_OBJECT_KEY", 400);
  }

  // ===================================================
  // 6. VALIDATE MEDIA TYPE
  // ===================================================

  const extension = parts[2].split(".").pop()?.toLowerCase();

  if (payload.mediaType === BannerMediaType.IMAGE && extension !== "jpg") {
    throw new AppError("INVALID_BANNER_MEDIA_TYPE", 400);
  }

  if (payload.mediaType === BannerMediaType.VIDEO && extension !== "mp4") {
    throw new AppError("INVALID_BANNER_MEDIA_TYPE", 400);
  }

  // ===================================================
  // 7. VALIDATE SORT ORDER
  // ===================================================

  const sortOrder = payload.sortOrder ?? 0;

  if (!Number.isSafeInteger(sortOrder) || sortOrder < 0) {
    throw new AppError("INVALID_BANNER_MEDIA_SORT_ORDER", 400);
  }

  // ===================================================
  // 8. PREVENT DUPLICATE MEDIA
  // ===================================================

  const existingMedia = await prisma.bannerMedia.findFirst({
    where: {
      objectKey: payload.objectKey,
    },
    select: {
      id: true,
    },
  });

  if (existingMedia) {
    throw new AppError("BANNER_MEDIA_ALREADY_ATTACHED", 409);
  }

  // ===================================================
  // 9. VERIFY FILE EXISTS IN CLOUDFLARE R2
  // ===================================================

  // Checks object existence, MIME type and actual file size.
  // IMAGE: JPEG, max 5 MB
  // VIDEO: MP4, max 50 MB

  await uploadService.verifyImageExists(payload.objectKey);

  // ===================================================
  // 10. SAVE MEDIA IN DATABASE
  // ===================================================

  const media = await prisma.bannerMedia.create({
    data: {
      bannerId,
      objectKey: payload.objectKey,
      mediaType: payload.mediaType,
      sortOrder,
    },
  });

  // ===================================================
  // 11. GENERATE SIGNED MEDIA URL
  // ===================================================

  const url = await uploadService.getImageUrl(media.objectKey);

  // ===================================================
  // 12. RETURN RESPONSE
  // ===================================================

  return {
    id: media.id,
    bannerId: media.bannerId,
    mediaType: media.mediaType,
    objectKey: media.objectKey,
    url,
    sortOrder: media.sortOrder,
    createdAt: media.createdAt,
  };
};

const updateBannerStatus = async (
  bannerId: string,
  status: BannerStatus,
  actor: IBannerActor,
) => {
  // 1. Role authorization
  if (actor.role !== Role.BRAND_OWNER && actor.role !== Role.BRANCH_MANAGER) {
    throw new AppError("You are not allowed to update banner status", 403);
  }

  // 2. Find banner with branches and media
  const banner = await prisma.banner.findUnique({
    where: {
      id: bannerId,
    },
    include: {
      branches: {
        select: {
          branchId: true,
        },
      },
      media: {
        select: {
          id: true,
        },
      },
    },
  });

  if (!banner) {
    throw new AppError("Banner not found", 404);
  }

  // 3. Brand authorization
  if (banner.brandId !== actor.brandId) {
    throw new AppError("You cannot manage this banner", 403);
  }

  // 4. Branch manager authorization
  if (actor.role === Role.BRANCH_MANAGER) {
    if (
      banner.scope !== BannerScope.SELECTED_BRANCHES ||
      banner.branches.length === 0
    ) {
      throw new AppError(
        "Branch managers can only manage selected-branch banners",
        403,
      );
    }

    const managerBranches = await prisma.branchManagerBranch.findMany({
      where: {
        userId: actor.userId,
      },
      select: {
        branchId: true,
      },
    });

    const allowedBranchIds = new Set(
      managerBranches.map((item) => item.branchId),
    );

    const hasAccess = banner.branches.every((item) =>
      allowedBranchIds.has(item.branchId),
    );

    if (!hasAccess) {
      throw new AppError("You are not allowed to manage this banner", 403);
    }
  }

  // 5. Validate activation
  if (status === BannerStatus.ACTIVE) {
    if (banner.media.length === 0) {
      throw new AppError("Cannot activate banner without attached media", 400);
    }

    if (
      banner.startAt &&
      banner.endAt &&
      banner.startAt.getTime() >= banner.endAt.getTime()
    ) {
      throw new AppError("Banner end date must be after start date", 400);
    }

    if (
      banner.scope === BannerScope.SELECTED_BRANCHES &&
      banner.branches.length === 0
    ) {
      throw new AppError(
        "Selected-branches banner must have at least one branch",
        400,
      );
    }
  }

  // 6. Update banner status
  const updatedBanner = await prisma.banner.update({
    where: {
      id: bannerId,
    },
    data: {
      status,
    },
    include: {
      branches: {
        select: {
          branchId: true,
        },
      },
      media: {
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      },
    },
  });

  // 7. Generate signed URLs
  const mediaWithUrls = await Promise.all(
    updatedBanner.media.map(async (media) => ({
      ...media,
      url: await uploadService.getImageUrl(media.objectKey),
    })),
  );

  return {
    ...updatedBanner,
    media: mediaWithUrls,
  };
};

const getBannerDetails = async (bannerId: string, actor: IBannerActor) => {
  // 1. Check role
  if (actor.role !== Role.BRAND_OWNER && actor.role !== Role.BRANCH_MANAGER) {
    throw new AppError("You are not allowed to view banner details", 403);
  }

  // 2. Find banner
  const banner = await prisma.banner.findUnique({
    where: {
      id: bannerId,
    },
    include: {
      branches: {
        select: {
          branchId: true,
          branch: {
            select: {
              id: true,
              name: true,
              status: true,
            },
          },
        },
      },
      media: {
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      },
    },
  });

  if (!banner) {
    throw new AppError("Banner not found", 404);
  }

  // 3. Verify brand ownership
  if (banner.brandId !== actor.brandId) {
    throw new AppError("You cannot view this banner", 403);
  }

  // 4. Branch Manager authorization
  if (actor.role === Role.BRANCH_MANAGER) {
    if (
      banner.scope !== BannerScope.SELECTED_BRANCHES ||
      banner.branches.length === 0
    ) {
      throw new AppError(
        "Branch managers can only view banners assigned to their branches",
        403,
      );
    }

    const managerBranches = await prisma.branchManagerBranch.findMany({
      where: {
        userId: actor.userId,
      },
      select: {
        branchId: true,
      },
    });

    const allowedBranchIds = new Set(
      managerBranches.map((item) => item.branchId),
    );

    // Manager must have access to every selected branch
    const hasAccess = banner.branches.every((item) =>
      allowedBranchIds.has(item.branchId),
    );

    if (!hasAccess) {
      throw new AppError("You are not allowed to view this banner", 403);
    }
  }

  // 5. Generate signed URLs for attached media
  const mediaWithUrls = await Promise.all(
    banner.media.map(async (media) => ({
      ...media,
      url: await uploadService.getImageUrl(media.objectKey),
    })),
  );

  // 6. Calculate current visibility
  const now = new Date();

  const isWithinSchedule =
    (!banner.startAt || banner.startAt <= now) &&
    (!banner.endAt || banner.endAt > now);

  const isCurrentlyActive =
    banner.status === BannerStatus.ACTIVE && isWithinSchedule;

  // 7. Return complete banner details
  return {
    ...banner,

    branchIds: banner.branches.map((item) => item.branchId),

    media: mediaWithUrls,

    isWithinSchedule,
    isCurrentlyActive,
  };
};

const getAdminBanners = async (
  query: IAdminBannerQuery,
  actor: IBannerActor,
) => {
  // 1. Role authorization
  if (actor.role !== Role.BRAND_OWNER && actor.role !== Role.BRANCH_MANAGER) {
    throw new AppError("You are not allowed to view admin banners", 403);
  }

  // 2. Pagination
  const page = Math.max(1, Number(query.page ?? 1));
  const limit = Math.min(100, Math.max(1, Number(query.limit ?? 10)));

  const skip = (page - 1) * limit;

  // 3. Filters
  const where: Prisma.BannerWhereInput = {
    brandId: actor.brandId,
  };

  if (query.search?.trim()) {
    const search = query.search.trim();

    where.OR = [
      {
        title: {
          contains: search,
        },
      },
      {
        description: {
          contains: search,
        },
      },
    ];
  }

  if (query.status) {
    where.status = query.status;
  }

  if (query.scope) {
    where.scope = query.scope;
  }

  if (query.branchId) {
    where.branches = {
      some: {
        branchId: query.branchId,
      },
    };
  }

  // 4. Branch Manager authorization
  if (actor.role === Role.BRANCH_MANAGER) {
    const managerBranches = await prisma.branchManagerBranch.findMany({
      where: {
        userId: actor.userId,
      },
      select: {
        branchId: true,
      },
    });

    const allowedBranchIds = managerBranches.map((item) => item.branchId);

    // No assigned branches means no accessible banners
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

    // Managers can only view banners exclusively assigned
    // to branches they manage.
    const managerAccessFilter: Prisma.BannerWhereInput = {
      scope: BannerScope.SELECTED_BRANCHES,
      branches: {
        some: {
          branchId: {
            in: allowedBranchIds,
          },
        },
        every: {
          branchId: {
            in: allowedBranchIds,
          },
        },
      },
    };

    where.AND = [managerAccessFilter];
  }

  // 5. Sorting
  const allowedSortFields = [
    "createdAt",
    "updatedAt",
    "sortOrder",
    "startAt",
    "endAt",
  ] as const;

  const sortBy = allowedSortFields.includes(
    query.sortBy as (typeof allowedSortFields)[number],
  )
    ? query.sortBy!
    : "createdAt";

  const sortOrder = query.sortOrder === "asc" ? "asc" : "desc";

  const orderBy: Prisma.BannerOrderByWithRelationInput[] = [
    {
      [sortBy]: sortOrder,
    },
    {
      id: "asc",
    },
  ];

  // 6. Fetch banners and total count
  const [banners, total] = await Promise.all([
    prisma.banner.findMany({
      where,
      skip,
      take: limit,
      orderBy,
      include: {
        branches: {
          select: {
            branchId: true,
            branch: {
              select: {
                id: true,
                name: true,
                status: true,
              },
            },
          },
        },
        media: {
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        },
      },
    }),

    prisma.banner.count({
      where,
    }),
  ]);

  // 7. Generate signed media URLs
  const now = new Date();

  const items = await Promise.all(
    banners.map(async (banner) => {
      const media = await Promise.all(
        banner.media.map(async (item) => ({
          ...item,
          url: await uploadService.getImageUrl(item.objectKey),
        })),
      );

      const isWithinSchedule =
        (!banner.startAt || banner.startAt <= now) &&
        (!banner.endAt || banner.endAt > now);

      const isCurrentlyActive =
        banner.status === BannerStatus.ACTIVE && isWithinSchedule;

      return {
        ...banner,
        branchIds: banner.branches.map((item) => item.branchId),
        media,
        isWithinSchedule,
        isCurrentlyActive,
      };
    }),
  );

  // 8. Pagination metadata
  const totalPages = Math.ceil(total / limit);

  return {
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

const updateBanner = async (
  bannerId: string,
  payload: IUpdateBannerPayload,
  actor: IBannerActor,
) => {
  // 1. Role authorization
  if (actor.role !== Role.BRAND_OWNER && actor.role !== Role.BRANCH_MANAGER) {
    throw new AppError("You are not allowed to update banners", 403);
  }

  // 2. Validate update payload
  if (Object.keys(payload).length === 0) {
    throw new AppError("At least one field is required", 400);
  }

  // 3. Find existing banner
  const existingBanner = await prisma.banner.findUnique({
    where: {
      id: bannerId,
    },
    include: {
      branches: {
        select: {
          branchId: true,
        },
      },
    },
  });

  if (!existingBanner) {
    throw new AppError("Banner not found", 404);
  }

  if (existingBanner.brandId !== actor.brandId) {
    throw new AppError("You cannot update this banner", 403);
  }

  // 4. Resolve current and requested scope
  const nextScope = payload.scope ?? existingBanner.scope;

  const currentBranchIds = existingBanner.branches.map((item) => item.branchId);

  let nextBranchIds =
    payload.branchIds !== undefined
      ? [...payload.branchIds]
      : [...currentBranchIds];

  // Explicitly switching to BRAND_WIDE clears branch assignments.
  if (nextScope === BannerScope.BRAND_WIDE) {
    if (payload.branchIds !== undefined && payload.branchIds.length > 0) {
      throw new AppError(
        "BRAND_WIDE banners cannot have selected branches",
        400,
      );
    }

    nextBranchIds = [];
  }

  // 5. Validate final branch assignments
  if (
    nextScope === BannerScope.SELECTED_BRANCHES &&
    nextBranchIds.length === 0
  ) {
    throw new AppError(
      "SELECTED_BRANCHES banners require at least one branch",
      400,
    );
  }

  const uniqueBranchIds = [...new Set(nextBranchIds)];

  if (uniqueBranchIds.length !== nextBranchIds.length) {
    throw new AppError("Duplicate branch IDs are not allowed", 400);
  }

  if (uniqueBranchIds.length > 0) {
    const branches = await prisma.branch.findMany({
      where: {
        id: {
          in: uniqueBranchIds,
        },
      },
      select: {
        id: true,
      },
    });

    if (branches.length !== uniqueBranchIds.length) {
      throw new AppError("One or more selected branches were not found", 400);
    }
  }

  // 6. Branch Manager authorization
  if (actor.role === Role.BRANCH_MANAGER) {
    // Cannot edit an existing brand-wide banner.
    if (
      existingBanner.scope !== BannerScope.SELECTED_BRANCHES ||
      currentBranchIds.length === 0
    ) {
      throw new AppError(
        "Branch managers cannot update brand-wide banners",
        403,
      );
    }

    // Cannot convert a branch banner into brand-wide.
    if (nextScope !== BannerScope.SELECTED_BRANCHES) {
      throw new AppError(
        "Branch managers cannot create brand-wide banners",
        403,
      );
    }

    const managerBranches = await prisma.branchManagerBranch.findMany({
      where: {
        userId: actor.userId,
      },
      select: {
        branchId: true,
      },
    });

    const allowedBranchIds = new Set(
      managerBranches.map((item) => item.branchId),
    );

    // Check access to existing branches.
    const canManageExisting = currentBranchIds.every((branchId) =>
      allowedBranchIds.has(branchId),
    );

    if (!canManageExisting) {
      throw new AppError("You are not allowed to update this banner", 403);
    }

    // Check access to requested branches.
    const canManageRequested = uniqueBranchIds.every((branchId) =>
      allowedBranchIds.has(branchId),
    );

    if (!canManageRequested) {
      throw new AppError(
        "You cannot assign banners to branches you do not manage",
        403,
      );
    }
  }

  // 7. Resolve schedule
  const nextStartAt =
    payload.startAt === undefined
      ? existingBanner.startAt
      : payload.startAt === null
        ? null
        : new Date(payload.startAt);

  const nextEndAt =
    payload.endAt === undefined
      ? existingBanner.endAt
      : payload.endAt === null
        ? null
        : new Date(payload.endAt);

  if (
    (nextStartAt && Number.isNaN(nextStartAt.getTime())) ||
    (nextEndAt && Number.isNaN(nextEndAt.getTime()))
  ) {
    throw new AppError("Invalid banner schedule", 400);
  }

  if (
    nextStartAt &&
    nextEndAt &&
    nextStartAt.getTime() >= nextEndAt.getTime()
  ) {
    throw new AppError("Banner end date must be after start date", 400);
  }

  // 8. Update banner and branch assignments atomically
  const updatedBanner = await prisma.$transaction(async (tx) => {
    const updated = await tx.banner.update({
      where: {
        id: bannerId,
      },
      data: {
        ...(payload.title !== undefined && {
          title: payload.title,
        }),

        ...(payload.description !== undefined && {
          description: payload.description,
        }),

        scope: nextScope,
        startAt: nextStartAt,
        endAt: nextEndAt,

        ...(payload.sortOrder !== undefined && {
          sortOrder: payload.sortOrder,
        }),
      },
    });

    // Replace assignments only when the effective set changed.
    const assignmentsChanged =
      currentBranchIds.length !== uniqueBranchIds.length ||
      currentBranchIds.some((branchId) => !uniqueBranchIds.includes(branchId));

    if (assignmentsChanged) {
      await tx.bannerBranch.deleteMany({
        where: {
          bannerId,
        },
      });

      if (uniqueBranchIds.length > 0) {
        await tx.bannerBranch.createMany({
          data: uniqueBranchIds.map((branchId) => ({
            bannerId,
            branchId,
          })),
        });
      }
    }

    return updated;
  });

  // 9. Fetch complete updated banner
  const result = await prisma.banner.findUniqueOrThrow({
    where: {
      id: updatedBanner.id,
    },
    include: {
      branches: {
        select: {
          branchId: true,
          branch: {
            select: {
              id: true,
              name: true,
              status: true,
            },
          },
        },
      },
      media: {
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      },
    },
  });

  // 10. Generate signed media URLs
  const mediaWithUrls = await Promise.all(
    result.media.map(async (media) => ({
      ...media,
      url: await uploadService.getImageUrl(media.objectKey),
    })),
  );

  const now = new Date();

  const isWithinSchedule =
    (!result.startAt || result.startAt <= now) &&
    (!result.endAt || result.endAt > now);

  return {
    ...result,
    branchIds: result.branches.map((item) => item.branchId),
    media: mediaWithUrls,
    isWithinSchedule,
    isCurrentlyActive:
      result.status === BannerStatus.ACTIVE && isWithinSchedule,
  };
};

// =====================================================
// API 07 — REMOVE BANNER MEDIA
// =====================================================

const removeBannerMedia = async (
  bannerId: string,
  mediaId: string,
  actor: IBannerActor,
) => {
  // 1. Role authorization
  if (actor.role !== Role.BRAND_OWNER && actor.role !== Role.BRANCH_MANAGER) {
    throw new AppError("You are not allowed to remove banner media", 403);
  }

  // 2. Resolve manager's assigned branches
  const allowedBranchIds = new Set<string>();

  if (actor.role === Role.BRANCH_MANAGER) {
    const managerBranches = await prisma.branchManagerBranch.findMany({
      where: {
        userId: actor.userId,
      },
      select: {
        branchId: true,
      },
    });

    for (const item of managerBranches) {
      allowedBranchIds.add(item.branchId);
    }
  }

  // 3. Perform authorization and deletion transactionally
  const result = await prisma.$transaction(
    async (tx) => {
      const banner = await tx.banner.findUnique({
        where: {
          id: bannerId,
        },
        include: {
          branches: {
            select: {
              branchId: true,
            },
          },
          media: {
            select: {
              id: true,
              objectKey: true,
              mediaType: true,
            },
          },
        },
      });

      if (!banner) {
        throw new AppError("Banner not found", 404);
      }

      // 4. Verify brand ownership
      if (banner.brandId !== actor.brandId) {
        throw new AppError("You cannot manage this banner", 403);
      }

      // 5. Branch manager authorization
      if (actor.role === Role.BRANCH_MANAGER) {
        if (
          banner.scope !== BannerScope.SELECTED_BRANCHES ||
          banner.branches.length === 0
        ) {
          throw new AppError(
            "Branch managers can only manage selected-branch banners",
            403,
          );
        }

        const hasAccess = banner.branches.every((item) =>
          allowedBranchIds.has(item.branchId),
        );

        if (!hasAccess) {
          throw new AppError("You are not allowed to manage this banner", 403);
        }
      }

      // 6. Verify media belongs to this banner
      const media = banner.media.find((item) => item.id === mediaId);

      if (!media) {
        throw new AppError("Banner media not found", 404);
      }

      // 7. Prevent removing the last media from ACTIVE banner
      if (banner.status === BannerStatus.ACTIVE && banner.media.length <= 1) {
        throw new AppError(
          "Cannot remove the last media from an ACTIVE banner. Deactivate the banner first.",
          400,
        );
      }

      // 8. Delete media record from database
      await tx.bannerMedia.delete({
        where: {
          id: mediaId,
        },
      });

      return {
        bannerId,
        mediaId,
        objectKey: media.objectKey,
        mediaType: media.mediaType,
        removed: true,
        storageDeleted: false,
      };
    },
    {
      isolationLevel: "Serializable",
    },
  );

  return result;
};

// =====================================================
// API 08 — DELETE BANNER
// =====================================================

const deleteBanner = async (bannerId: string, actor: IBannerActor) => {
  // 1. Role authorization
  if (actor.role !== Role.BRAND_OWNER && actor.role !== Role.BRANCH_MANAGER) {
    throw new AppError("You are not allowed to delete banners", 403);
  }

  // 2. Find banner and its relations
  const banner = await prisma.banner.findUnique({
    where: {
      id: bannerId,
    },
    include: {
      branches: {
        select: {
          branchId: true,
        },
      },
      media: {
        select: {
          id: true,
          objectKey: true,
          mediaType: true,
        },
      },
    },
  });

  if (!banner) {
    throw new AppError("Banner not found", 404);
  }

  // 3. Brand authorization
  if (banner.brandId !== actor.brandId) {
    throw new AppError("You cannot delete this banner", 403);
  }

  // 4. Branch Manager authorization
  if (actor.role === Role.BRANCH_MANAGER) {
    if (
      banner.scope !== BannerScope.SELECTED_BRANCHES ||
      banner.branches.length === 0
    ) {
      throw new AppError(
        "Branch managers cannot delete brand-wide banners",
        403,
      );
    }

    const managerBranches = await prisma.branchManagerBranch.findMany({
      where: {
        userId: actor.userId,
      },
      select: {
        branchId: true,
      },
    });

    const allowedBranchIds = new Set(
      managerBranches.map((item) => item.branchId),
    );

    const canDelete = banner.branches.every((item) =>
      allowedBranchIds.has(item.branchId),
    );

    if (!canDelete) {
      throw new AppError("You are not allowed to delete this banner", 403);
    }
  }

  // 5. ACTIVE banner cannot be deleted directly
  if (banner.status === BannerStatus.ACTIVE) {
    throw new AppError(
      "ACTIVE banners cannot be deleted. Change status to INACTIVE first.",
      400,
    );
  }

  // 6. Save media keys before deleting database records
  const mediaFiles = banner.media.map((item) => ({
    mediaId: item.id,
    objectKey: item.objectKey,
    mediaType: item.mediaType,
  }));

  // 7. Delete only if banner is still non-ACTIVE
  const deleted = await prisma.banner.deleteMany({
    where: {
      id: bannerId,
      brandId: actor.brandId,
      status: {
        in: [BannerStatus.DRAFT, BannerStatus.INACTIVE],
      },
    },
  });

  if (deleted.count !== 1) {
    throw new AppError(
      "Banner could not be deleted. Its status may have changed.",
      409,
    );
  }

  // 8. Return deleted banner information
  return {
    id: bannerId,
    deleted: true,
    deletedMediaRecords: mediaFiles.length,
    storageDeleted: false,
    mediaFiles,
  };
};

// =====================================================
// API 09 — GET CUSTOMER ACTIVE BANNERS
// =====================================================

const getActiveBanners = async (query: IGetActiveBannersQuery) => {
  const { branchId } = query;

  const page = Math.max(1, Number(query.page ?? 1));

  const limit = Math.min(50, Math.max(1, Number(query.limit ?? 10)));

  const skip = (page - 1) * limit;

  const now = new Date();

  // 1. Verify branch exists and is active
  const branch = await prisma.branch.findUnique({
    where: {
      id: branchId,
    },
    select: {
      id: true,
      name: true,
      status: true,
    },
  });

  if (!branch) {
    throw new AppError("Branch not found", 404);
  }

  if (branch.status !== "ACTIVE") {
    throw new AppError("This branch is currently inactive", 400);
  }

  // 2. Find the application's brand
  // Current project uses one global brand.
  const brand = await prisma.brand.findFirst({
    select: {
      id: true,
    },
  });

  if (!brand) {
    throw new AppError("Brand not found", 404);
  }

  // 3. Filter visible banners
  const where: Prisma.BannerWhereInput = {
    brandId: brand.id,

    status: BannerStatus.ACTIVE,

    AND: [
      {
        OR: [
          {
            startAt: null,
          },
          {
            startAt: {
              lte: now,
            },
          },
        ],
      },
      {
        OR: [
          {
            endAt: null,
          },
          {
            endAt: {
              gt: now,
            },
          },
        ],
      },
    ],

    // Banner must have at least one attached media.
    media: {
      some: {},
    },

    OR: [
      {
        scope: BannerScope.BRAND_WIDE,
      },
      {
        scope: BannerScope.SELECTED_BRANCHES,
        branches: {
          some: {
            branchId,
          },
        },
      },
    ],
  };

  // 4. Fetch banners and total count
  const [banners, total] = await Promise.all([
    prisma.banner.findMany({
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
        {
          id: "asc",
        },
      ],

      select: {
        id: true,
        title: true,
        description: true,
        scope: true,
        sortOrder: true,
        startAt: true,
        endAt: true,

        media: {
          orderBy: [
            {
              sortOrder: "asc",
            },
            {
              createdAt: "asc",
            },
            {
              id: "asc",
            },
          ],

          select: {
            id: true,
            mediaType: true,
            objectKey: true,
            sortOrder: true,
          },
        },
      },
    }),

    prisma.banner.count({
      where,
    }),
  ]);

  // 5. Generate signed R2 URLs
  const items = await Promise.all(
    banners.map(async (banner) => {
      const media = await Promise.all(
        banner.media.map(async (item) => {
          const url = await uploadService.getImageUrl(item.objectKey);

          return {
            id: item.id,
            mediaType: item.mediaType,
            url,
            sortOrder: item.sortOrder,
          };
        }),
      );

      return {
        id: banner.id,
        title: banner.title,
        description: banner.description,
        sortOrder: banner.sortOrder,
        media,
      };
    }),
  );

  // 6. Pagination
  const totalPages = Math.ceil(total / limit);

  return {
    branch: {
      id: branch.id,
      name: branch.name,
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
// API 10 — UPDATE BANNER MEDIA ORDER
// =====================================================

const updateBannerMediaOrder = async (
  bannerId: string,
  payload: IUpdateBannerMediaOrderPayload,
  actor: IBannerActor,
) => {
  // 1. Role authorization
  if (actor.role !== Role.BRAND_OWNER && actor.role !== Role.BRANCH_MANAGER) {
    throw new AppError("You are not allowed to update banner media order", 403);
  }

  // 2. Validate media IDs
  const mediaIds = payload.mediaIds;

  if (!Array.isArray(mediaIds) || mediaIds.length === 0) {
    throw new AppError("At least one media ID is required", 400);
  }

  if (new Set(mediaIds).size !== mediaIds.length) {
    throw new AppError("Duplicate media IDs are not allowed", 400);
  }

  // 3. Find banner
  const banner = await prisma.banner.findUnique({
    where: {
      id: bannerId,
    },
    include: {
      branches: {
        select: {
          branchId: true,
        },
      },
      media: {
        select: {
          id: true,
          mediaType: true,
          objectKey: true,
          sortOrder: true,
        },
      },
    },
  });

  if (!banner) {
    throw new AppError("Banner not found", 404);
  }

  // 4. Brand authorization
  if (banner.brandId !== actor.brandId) {
    throw new AppError("You cannot manage this banner", 403);
  }

  // 5. Branch Manager authorization
  if (actor.role === Role.BRANCH_MANAGER) {
    if (
      banner.scope !== BannerScope.SELECTED_BRANCHES ||
      banner.branches.length === 0
    ) {
      throw new AppError(
        "Branch managers cannot manage brand-wide banners",
        403,
      );
    }

    const managerBranches = await prisma.branchManagerBranch.findMany({
      where: {
        userId: actor.userId,
      },
      select: {
        branchId: true,
      },
    });

    const allowedBranchIds = new Set(
      managerBranches.map((item) => item.branchId),
    );

    const hasAccess = banner.branches.every((item) =>
      allowedBranchIds.has(item.branchId),
    );

    if (!hasAccess) {
      throw new AppError("You are not allowed to manage this banner", 403);
    }
  }

  // 6. Verify media exists
  if (banner.media.length === 0) {
    throw new AppError("This banner has no attached media", 400);
  }

  // 7. Require complete media list
  if (mediaIds.length !== banner.media.length) {
    throw new AppError("You must provide all existing banner media IDs", 400);
  }

  const existingMediaIds = new Set(banner.media.map((item) => item.id));

  const allMediaBelongToBanner = mediaIds.every((mediaId) =>
    existingMediaIds.has(mediaId),
  );

  if (!allMediaBelongToBanner) {
    throw new AppError(
      "One or more media IDs do not belong to this banner",
      400,
    );
  }

  // 8. Update sortOrder atomically
  const operations = mediaIds.map((mediaId, index) =>
    prisma.bannerMedia.update({
      where: {
        id: mediaId,
      },
      data: {
        sortOrder: index,
      },
    }),
  );

  await prisma.$transaction(operations);

  // 9. Fetch updated media in new order
  const updatedMedia = await prisma.bannerMedia.findMany({
    where: {
      bannerId,
    },
    orderBy: [
      {
        sortOrder: "asc",
      },
      {
        createdAt: "asc",
      },
      {
        id: "asc",
      },
    ],
  });

  // 10. Generate signed R2 URLs
  const mediaWithUrls = await Promise.all(
    updatedMedia.map(async (media) => ({
      ...media,
      url: await uploadService.getImageUrl(media.objectKey),
    })),
  );

  return {
    bannerId,
    totalMedia: mediaWithUrls.length,
    media: mediaWithUrls,
  };
};

const getBannerCarouselSettings = async (branchId: string) => {
  // =====================================================
  // 1. VERIFY BRANCH
  // =====================================================

  const branch = await prisma.branch.findUnique({
    where: {
      id: branchId,
    },
    select: {
      id: true,
      name: true,
    },
  });

  if (!branch) {
    throw new AppError("Branch not found", 404);
  }

  // =====================================================
  // 2. FETCH BRANCH CAROUSEL SETTINGS
  // =====================================================

  const settings = await prisma.bannerCarouselSetting.findUnique({
    where: {
      branchId,
    },
    select: {
      imageIntervalMs: true,
      videoIntervalMs: true,
    },
  });

  // =====================================================
  // 3. RETURN SETTINGS WITH DEFAULT FALLBACK
  // =====================================================

  return {
    branchId: branch.id,
    imageIntervalMs: settings?.imageIntervalMs ?? 5000,
    videoIntervalMs: settings?.videoIntervalMs ?? 15000,
  };
};

const updateBannerCarouselSettings = async (
  branchId: string,
  payload: {
    imageIntervalMs?: number;
    videoIntervalMs?: number;
  },
  actor: IBannerActor,
) => {
  // =====================================================
  // 1. VERIFY USER ROLE
  // =====================================================

  if (actor.role !== Role.BRAND_OWNER && actor.role !== Role.BRANCH_MANAGER) {
    throw new AppError(
      "You are not authorized to update carousel settings",
      403,
    );
  }

  // =====================================================
  // 2. VALIDATE PAYLOAD
  // =====================================================

  const { imageIntervalMs, videoIntervalMs } = payload;

  if (imageIntervalMs === undefined && videoIntervalMs === undefined) {
    throw new AppError("At least one carousel interval is required", 400);
  }

  for (const [field, value] of Object.entries(payload)) {
    if (
      value !== undefined &&
      (!Number.isInteger(value) || value < 1000 || value > 120000)
    ) {
      throw new AppError(
        `${field} must be an integer between 1000 and 120000 milliseconds`,
        400,
      );
    }
  }

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
    },
  });

  if (!branch) {
    throw new AppError("Branch not found", 404);
  }

  // =====================================================
  // 4. VERIFY BRANCH MANAGER ASSIGNMENT
  // =====================================================

  if (actor.role === Role.BRANCH_MANAGER) {
    const assignment = await prisma.branchManagerBranch.findFirst({
      where: {
        userId: actor.userId,
        branchId,
      },
      select: {
        branchId: true,
      },
    });

    if (!assignment) {
      throw new AppError(
        "You can only update carousel settings for your assigned branches",
        403,
      );
    }
  }

  // =====================================================
  // 5. CREATE OR UPDATE CAROUSEL SETTINGS
  // =====================================================

  const settings = await prisma.bannerCarouselSetting.upsert({
    where: {
      branchId,
    },
    create: {
      branchId,
      imageIntervalMs: imageIntervalMs ?? 5000,
      videoIntervalMs: videoIntervalMs ?? 15000,
    },
    update: {
      ...(imageIntervalMs !== undefined ? { imageIntervalMs } : {}),
      ...(videoIntervalMs !== undefined ? { videoIntervalMs } : {}),
    },
  });

  // =====================================================
  // 6. RETURN UPDATED SETTINGS
  // =====================================================

  return {
    branchId: settings.branchId,
    imageIntervalMs: settings.imageIntervalMs,
    videoIntervalMs: settings.videoIntervalMs,
    updatedAt: settings.updatedAt,
  };
};

export const bannerService = {
  createBanner,
  attachBannerMedia,
  updateBannerStatus,
  getBannerDetails,
  getAdminBanners,
  updateBanner,
  removeBannerMedia,
  deleteBanner,
  getActiveBanners,
  updateBannerMediaOrder,
  getBannerCarouselSettings,
  updateBannerCarouselSettings,
};
