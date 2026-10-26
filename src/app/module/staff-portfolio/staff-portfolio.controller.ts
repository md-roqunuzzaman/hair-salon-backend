import { Request, Response } from "express";
import { z } from "zod";

import { catchAsync } from "../../utils/catchAsync.js";
import { sendResponse } from "../../utils/sendResponse.js";
import { staffPortfolioService } from "./staff-portfolio.service.js";

import { DEFAULT_LANGUAGE, Language } from "../../utils/language.js";
import { StaffPortfolioStatus } from "../../../../generated/prisma/enums.js";

// =====================================================
// GET STAFF PORTFOLIO
// GET /api/v1/staff/:staffId/portfolio
// =====================================================

const getStaffPortfolio = catchAsync(async (req: Request, res: Response) => {
  // 1. Validate staff ID
  const staffId = z.uuid().parse(req.params.staffId);

  // 2. Read language from existing middleware
  const language: Language =
    (req.headers["accept-language"]?.split(",")[0]?.trim() as Language) ||
    DEFAULT_LANGUAGE;

  // 3. Call service
  const result = await staffPortfolioService.getStaffPortfolio(
    staffId,
    language,
  );

  // 4. Send standardized response
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Staff portfolio retrieved successfully",
    data: result,
  });
});

// =====================================================
// GET PUBLISHED STAFF PORTFOLIO CASES
// GET /api/v1/staff/:staffId/portfolio/cases
// =====================================================

const getPublishedPortfolioCases = catchAsync(
  async (req: Request, res: Response) => {
    // 1. Validate staff ID
    const staffId = z.uuid().parse(req.params.staffId);

    // 2. Validate pagination
    const query = z
      .object({
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(100).default(20),
      })
      .parse(req.query);

    // 3. Get requested language
    const language: Language =
      (req.headers["accept-language"]?.split(",")[0]?.trim() as Language) ||
      DEFAULT_LANGUAGE;

    // 4. Call service
    const result = await staffPortfolioService.getPublishedPortfolioCases(
      staffId,
      query,
      language,
    );

    // 5. Send response
    sendResponse(res, {
      statusCode: 200,
      success: true,
      message: "Published staff portfolio cases retrieved successfully",
      data: result,
    });
  },
);

// =====================================================
// API 03 — GET SINGLE PUBLISHED PORTFOLIO CASE
// GET /api/v1/staff/:staffId/portfolio/cases/:caseId
// =====================================================

const getPublishedPortfolioCaseById = catchAsync(
  async (req: Request, res: Response) => {
    // 1. Validate IDs
    const staffId = z.uuid().parse(req.params.staffId);
    const caseId = z.uuid().parse(req.params.caseId);

    // 2. Get language
    const language: Language =
      (req.headers["accept-language"]?.split(",")[0]?.trim() as Language) ||
      DEFAULT_LANGUAGE;

    // 3. Call service
    const result = await staffPortfolioService.getPublishedPortfolioCaseById(
      staffId,
      caseId,
      language,
    );

    // 4. Send response
    sendResponse(res, {
      statusCode: 200,
      success: true,
      message: "Staff portfolio case retrieved successfully",
      data: result,
    });
  },
);

// =====================================================
// API 04 — GET ADMIN STAFF PORTFOLIO CASES
// =====================================================

const getAdminPortfolioCases = catchAsync(
  async (req: Request, res: Response) => {
    const staffId = z.uuid().parse(req.params.staffId);

    const query = z
      .object({
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(100).default(20),

        status: z.nativeEnum(StaffPortfolioStatus).optional(),
      })
      .parse(req.query);

    const language: Language =
      (req.headers["accept-language"]?.split(",")[0]?.trim() as Language) ||
      DEFAULT_LANGUAGE;

    // Uses authenticated user populated by your auth middleware.
    const requester = {
      id: req.user!.userId,
      role: req.user!.role,
    };

    const result = await staffPortfolioService.getAdminPortfolioCases(
      staffId,
      requester,
      query,
      language,
    );

    sendResponse(res, {
      statusCode: 200,
      success: true,
      message: "Admin staff portfolio cases retrieved successfully",
      data: result,
    });
  },
);

// =====================================================
// API 05 — CREATE STAFF PORTFOLIO CASE
// =====================================================

const createPortfolioCase = catchAsync(async (req: Request, res: Response) => {
  const staffId = z.uuid().parse(req.params.staffId);

  const translationSchema = z
    .object({
      title: z.string().trim().min(1).max(200).optional(),
      description: z.string().trim().max(5000).optional(),
    })
    .strict();

  const body = z
    .object({
      title: z.string().trim().min(1).max(200),

      description: z.string().trim().max(5000).nullable().optional(),

      serviceId: z.uuid().nullable().optional(),

      tags: z.array(z.string().trim().min(1).max(50)).max(20).optional(),

      translations: z
        .object({
          en: translationSchema.optional(),
          "zh-CN": translationSchema.optional(),
          "zh-HK": translationSchema.optional(),
        })
        .strict()
        .optional(),

      status: z.nativeEnum(StaffPortfolioStatus).optional(),

      sortOrder: z.number().int().min(0).optional(),
    })
    .strict()
    .parse(req.body);

  const requester = {
    id: req.user!.userId,
    role: req.user!.role,
  };

  const result = await staffPortfolioService.createPortfolioCase(
    staffId,
    requester,
    body,
  );

  sendResponse(res, {
    statusCode: 201,
    success: true,
    message: "Staff portfolio case created successfully",
    data: result,
  });
});

// =====================================================
// API 06 — UPDATE STAFF PORTFOLIO CASE
// =====================================================

const updatePortfolioCase = catchAsync(async (req: Request, res: Response) => {
  // 1. Validate IDs
  const staffId = z.uuid().parse(req.params.staffId);
  const caseId = z.uuid().parse(req.params.caseId);

  // 2. Translation validation
  const translationSchema = z
    .object({
      title: z.string().trim().min(1).max(200).optional(),
      description: z.string().trim().max(5000).optional(),
    })
    .strict();

  // 3. Validate partial update payload
  const body = z
    .object({
      title: z.string().trim().min(1).max(200).optional(),

      description: z.string().trim().max(5000).nullable().optional(),

      serviceId: z.uuid().nullable().optional(),

      tags: z.array(z.string().trim().min(1).max(50)).max(20).optional(),

      translations: z
        .object({
          en: translationSchema.optional(),
          "zh-CN": translationSchema.optional(),
          "zh-HK": translationSchema.optional(),
        })
        .strict()
        .nullable()
        .optional(),

      status: z.nativeEnum(StaffPortfolioStatus).optional(),

      sortOrder: z.number().int().min(0).optional(),
    })
    .strict()
    .refine((data) => Object.keys(data).length > 0, {
      message: "At least one field is required for update",
    })
    .parse(req.body);

  // 4. Authenticated requester
  const requester = {
    id: req.user!.userId,
    role: req.user!.role,
  };

  // 5. Call service
  const result = await staffPortfolioService.updatePortfolioCase(
    staffId,
    caseId,
    requester,
    body,
  );

  // 6. Response
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Staff portfolio case updated successfully",
    data: result,
  });
});

// =====================================================
// API 07 — ADD MULTIPLE PORTFOLIO IMAGES
// =====================================================

const addPortfolioImages = catchAsync(async (req: Request, res: Response) => {
  const staffId = z.uuid().parse(req.params.staffId);
  const caseId = z.uuid().parse(req.params.caseId);

  const body = z
    .object({
      images: z
        .array(
          z
            .object({
              objectKey: z.string().trim().min(1),

              isCover: z.boolean().optional(),

              sortOrder: z.number().int().min(0).optional(),
            })
            .strict(),
        )
        .min(1)
        .max(20),
    })
    .strict()
    .parse(req.body);

  const requester = {
    id: req.user!.userId,
    role: req.user!.role,
  };

  const result = await staffPortfolioService.addPortfolioImages(
    staffId,
    caseId,
    requester,
    body,
  );

  sendResponse(res, {
    statusCode: 201,
    success: true,
    message: "Portfolio images added successfully",
    data: result,
  });
});

// =====================================================
// API 08 — REORDER PORTFOLIO IMAGES / SET COVER
// =====================================================

const reorderPortfolioImages = catchAsync(
  async (req: Request, res: Response) => {
    // 1. Validate IDs
    const staffId = z.uuid().parse(req.params.staffId);
    const caseId = z.uuid().parse(req.params.caseId);

    // 2. Validate request body
    const body = z
      .object({
        images: z
          .array(
            z
              .object({
                imageId: z.uuid(),
                sortOrder: z.number().int().min(0),
                isCover: z.boolean(),
              })
              .strict(),
          )
          .min(1)
          .max(100),
      })
      .strict()
      .parse(req.body);

    // 3. Authenticated requester
    const requester = {
      id: req.user!.userId,
      role: req.user!.role,
    };

    // 4. Call service
    const result = await staffPortfolioService.reorderPortfolioImages(
      staffId,
      caseId,
      requester,
      body,
    );

    // 5. Send response
    sendResponse(res, {
      statusCode: 200,
      success: true,
      message: "Portfolio images reordered successfully",
      data: result,
    });
  },
);

// =====================================================
// API 09 — DELETE STAFF PORTFOLIO IMAGE
// =====================================================

const deletePortfolioImage = catchAsync(async (req: Request, res: Response) => {
  // 1. Validate IDs
  const staffId = z.uuid().parse(req.params.staffId);
  const caseId = z.uuid().parse(req.params.caseId);
  const imageId = z.uuid().parse(req.params.imageId);

  // 2. Authenticated requester
  const requester = {
    id: req.user!.userId,
    role: req.user!.role,
  };

  // 3. Call service
  const result = await staffPortfolioService.deletePortfolioImage(
    staffId,
    caseId,
    imageId,
    requester,
  );

  // 4. Send response
  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Portfolio image deleted successfully",
    data: result,
  });
});

// =====================================================
// API 10 — DELETE STAFF PORTFOLIO CASE
// =====================================================

const deletePortfolioCase = catchAsync(async (req: Request, res: Response) => {
  // =================================================
  // 1. VALIDATE PARAMS
  // =================================================

  const staffId = z.uuid().parse(req.params.staffId);
  const caseId = z.uuid().parse(req.params.caseId);

  // =================================================
  // 2. AUTHENTICATED REQUESTER
  // =================================================

  const requester = {
    id: req.user!.userId,
    role: req.user!.role,
  };

  // =================================================
  // 3. CALL SERVICE
  // =================================================

  const result = await staffPortfolioService.deletePortfolioCase(
    staffId,
    caseId,
    requester,
  );

  // =================================================
  // 4. SEND RESPONSE
  // =================================================

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Staff portfolio case deleted successfully",
    data: result,
  });
});
export const staffPortfolioController = {
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
};
