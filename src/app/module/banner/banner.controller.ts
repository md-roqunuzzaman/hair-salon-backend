import { Request, Response } from "express";
import httpStatus from "http-status";

import {
  BannerMediaType,
  BannerScope,
  BannerStatus,
  Role,
} from "../../../../generated/prisma/client.js";

import { catchAsync } from "../../utils/catchAsync.js";
import { sendResponse } from "../../utils/sendResponse.js";

import { bannerService } from "./banner.service.js";

import type { IBannerActor, ICreateBannerPayload } from "./banner.interface.js";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../utils/app-error.js";
import z from "zod";
const createBanner = catchAsync(async (req: Request, res: Response) => {
  // ===================================================
  // 1. AUTHENTICATED USER
  // ===================================================

  if (!req.user) {
    return res.status(httpStatus.UNAUTHORIZED).json({
      success: false,
      statusCode: httpStatus.UNAUTHORIZED,
      message: "Authentication required",
    });
  }

  // ===================================================
  // 2. VALIDATE AUTHENTICATED ROLE
  // ===================================================

  const role = req.user.role as Role;

  if (role !== Role.BRAND_OWNER && role !== Role.BRANCH_MANAGER) {
    return res.status(httpStatus.FORBIDDEN).json({
      success: false,
      statusCode: httpStatus.FORBIDDEN,
      message: "You are not allowed to create banners",
    });
  }

  // ===================================================
  // 3. RESOLVE BRAND
  // ===================================================

  // Single-brand architecture:
  // brandId must be resolved by trusted backend logic,
  // never accepted directly from the request body.

  const brand = await prisma.brand.findFirst({
    select: {
      id: true,
    },
  });

  if (!brand) {
    return res.status(httpStatus.NOT_FOUND).json({
      success: false,
      statusCode: httpStatus.NOT_FOUND,
      message: "Brand not found",
    });
  }

  // ===================================================
  // 4. PREPARE ACTOR
  // ===================================================

  const actor: IBannerActor = {
    userId: req.user.userId,
    role,
    brandId: brand.id,
  };

  // ===================================================
  // 5. PREPARE PAYLOAD
  // ===================================================

  const payload = req.body as ICreateBannerPayload;

  // ===================================================
  // 6. CREATE BANNER
  // ===================================================

  const result = await bannerService.createBanner(payload, actor);

  // ===================================================
  // 7. SEND RESPONSE
  // ===================================================

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Banner created successfully",
    data: result,
  });
});

// =====================================================
// API 02 — ATTACH BANNER MEDIA
// POST /api/v1/banners/:bannerId/media
// =====================================================

const attachBannerMedia = catchAsync(async (req: Request, res: Response) => {
  // ===================================================
  // 1. AUTHENTICATION
  // ===================================================

  if (!req.user) {
    throw new AppError("Authentication required", 401);
  }

  // ===================================================
  // 2. ROLE AUTHORIZATION
  // ===================================================

  const role = req.user.role;

  if (role !== Role.BRAND_OWNER && role !== Role.BRANCH_MANAGER) {
    throw new AppError("You are not allowed to attach banner media", 403);
  }

  // ===================================================
  // 3. VALIDATE BANNER ID
  // ===================================================

  const bannerId = z.uuid().parse(req.params.bannerId);

  // ===================================================
  // 4. RESOLVE BRAND
  // ===================================================

  // Existing single-brand architecture.
  // Never accept brandId directly from request body.

  const brand = await prisma.brand.findFirst({
    select: {
      id: true,
    },
  });

  if (!brand) {
    throw new AppError("BRAND_NOT_FOUND", 404);
  }

  // ===================================================
  // 5. PREPARE ACTOR
  // ===================================================

  const actor: IBannerActor = {
    userId: req.user.userId,
    role,
    brandId: brand.id,
  };

  // ===================================================
  // 6. PREPARE PAYLOAD
  // ===================================================

  const payload = req.body as {
    objectKey: string;
    mediaType: BannerMediaType;
    sortOrder?: number;
  };

  // ===================================================
  // 7. ATTACH MEDIA
  // ===================================================

  const result = await bannerService.attachBannerMedia(
    bannerId,
    payload,
    actor,
  );

  // ===================================================
  // 8. SEND RESPONSE
  // ===================================================

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Banner media attached successfully",
    data: result,
  });
});

const updateBannerStatus = catchAsync(async (req: Request, res: Response) => {
  // 1. Authentication
  if (!req.user) {
    throw new AppError("Unauthorized", 401);
  }

  // 2. Validate banner ID
  const bannerId = z.uuid().parse(req.params.bannerId);

  // 3. Resolve brand
  const brand = await prisma.brand.findFirst({
    select: {
      id: true,
    },
  });

  if (!brand) {
    throw new AppError("Brand not found", 404);
  }

  // 4. Update banner status
  const result = await bannerService.updateBannerStatus(
    bannerId,
    req.body.status,
    {
      userId: req.user.userId,
      role: req.user.role,
      brandId: brand.id,
    },
  );

  // 5. Response
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Banner status updated successfully",
    data: result,
  });
});

const getBannerDetails = catchAsync(async (req: Request, res: Response) => {
  // 1. Authentication
  if (!req.user) {
    throw new AppError("Unauthorized", 401);
  }

  // 2. Validate banner ID
  const bannerId = z.uuid().parse(req.params.bannerId);

  // 3. Resolve brand
  const brand = await prisma.brand.findFirst({
    select: {
      id: true,
    },
  });

  if (!brand) {
    throw new AppError("Brand not found", 404);
  }

  // 4. Get banner details
  const result = await bannerService.getBannerDetails(bannerId, {
    userId: req.user.userId,
    role: req.user.role,
    brandId: brand.id,
  });

  // 5. Send response
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Banner details retrieved successfully",
    data: result,
  });
});

const getAdminBanners = catchAsync(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError("Unauthorized", 401);
  }

  const brand = await prisma.brand.findFirst({
    select: {
      id: true,
    },
  });

  if (!brand) {
    throw new AppError("Brand not found", 404);
  }

  const result = await bannerService.getAdminBanners(
    {
      page: req.query.page ? Number(req.query.page) : 1,

      limit: req.query.limit ? Number(req.query.limit) : 10,

      search: req.query.search as string | undefined,

      status: req.query.status as BannerStatus | undefined,

      scope: req.query.scope as BannerScope | undefined,

      branchId: req.query.branchId as string | undefined,

      sortBy: req.query.sortBy as
        | "createdAt"
        | "updatedAt"
        | "sortOrder"
        | "startAt"
        | "endAt"
        | undefined,

      sortOrder: req.query.sortOrder as "asc" | "desc" | undefined,
    },
    {
      userId: req.user.userId,
      role: req.user.role,
      brandId: brand.id,
    },
  );

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Admin banners retrieved successfully",
    data: result,
  });
});

const updateBanner = catchAsync(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError("Unauthorized", 401);
  }

  const bannerId = z.uuid().parse(req.params.bannerId);

  const brand = await prisma.brand.findFirst({
    select: {
      id: true,
    },
  });

  if (!brand) {
    throw new AppError("Brand not found", 404);
  }

  const result = await bannerService.updateBanner(bannerId, req.body, {
    userId: req.user.userId,
    role: req.user.role,
    brandId: brand.id,
  });

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Banner updated successfully",
    data: result,
  });
});

// =====================================================
// API 07 — REMOVE BANNER MEDIA CONTROLLER
// =====================================================

const removeBannerMedia = catchAsync(async (req: Request, res: Response) => {
  // 1. Authentication
  if (!req.user) {
    throw new AppError("Unauthorized", 401);
  }

  // 2. Validate parameters
  const bannerId = z.uuid().parse(req.params.bannerId);

  const mediaId = z.uuid().parse(req.params.mediaId);

  // 3. Resolve brand
  const brand = await prisma.brand.findFirst({
    select: {
      id: true,
    },
  });

  if (!brand) {
    throw new AppError("Brand not found", 404);
  }

  // 4. Remove banner media
  const result = await bannerService.removeBannerMedia(bannerId, mediaId, {
    userId: req.user.userId,
    role: req.user.role,
    brandId: brand.id,
  });

  // 5. Send response
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Banner media removed successfully",
    data: result,
  });
});

// =====================================================
// API 08 — DELETE BANNER CONTROLLER
// =====================================================

const deleteBanner = catchAsync(async (req: Request, res: Response) => {
  // 1. Authentication
  if (!req.user) {
    throw new AppError("Unauthorized", 401);
  }

  // 2. Validate banner ID
  const bannerId = z.uuid().parse(req.params.bannerId);

  // 3. Resolve brand
  const brand = await prisma.brand.findFirst({
    select: {
      id: true,
    },
  });

  if (!brand) {
    throw new AppError("Brand not found", 404);
  }

  // 4. Delete banner
  const result = await bannerService.deleteBanner(bannerId, {
    userId: req.user.userId,
    role: req.user.role,
    brandId: brand.id,
  });

  // 5. Send response
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Banner deleted successfully",
    data: result,
  });
});

// =====================================================
// API 09 — GET CUSTOMER ACTIVE BANNERS CONTROLLER
// =====================================================

const getActiveBanners = catchAsync(async (req: Request, res: Response) => {
  const query = z
    .object({
      branchId: z.uuid(),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(50).default(10),
    })
    .parse(req.query);

  const result = await bannerService.getActiveBanners({
    branchId: query.branchId,
    page: query.page,
    limit: query.limit,
  });

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Active banners retrieved successfully",
    data: result,
  });
});

// =====================================================
// API 10 — UPDATE BANNER MEDIA ORDER CONTROLLER
// =====================================================

const updateBannerMediaOrder = catchAsync(
  async (req: Request, res: Response) => {
    // 1. Authentication
    if (!req.user) {
      throw new AppError("Unauthorized", 401);
    }

    // 2. Validate banner ID
    const bannerId = z.uuid().parse(req.params.bannerId);

    // 3. Resolve brand
    const brand = await prisma.brand.findFirst({
      select: {
        id: true,
      },
    });

    if (!brand) {
      throw new AppError("Brand not found", 404);
    }

    // 4. Update media order
    const result = await bannerService.updateBannerMediaOrder(
      bannerId,
      req.body,
      {
        userId: req.user.userId,
        role: req.user.role,
        brandId: brand.id,
      },
    );

    // 5. Send response
    sendResponse(res, {
      statusCode: 200,
      success: true,
      message: "Banner media order updated successfully",
      data: result,
    });
  },
);
export const bannerController = {
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
};
