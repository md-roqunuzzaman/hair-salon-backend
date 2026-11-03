import { Request, Response } from "express";
import { z } from "zod";

import { catchAsync } from "../../utils/catchAsync.js";
import { sendResponse } from "../../utils/sendResponse.js";
import { DEFAULT_LANGUAGE, Language } from "../../utils/language.js";
import { branchPortfolioService } from "./branch-portfolio.service.js";
import { StaffPortfolioStatus } from "../../../../generated/prisma/enums.js";

const getBranchPortfolio = catchAsync(async (req: Request, res: Response) => {
  const branchId = z.uuid().parse(req.params.branchId);

  const query = z
    .object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(20),
      serviceId: z.uuid().optional(),
      staffId: z.uuid().optional(),
    })
    .parse(req.query);

  const language: Language =
    (req.headers["accept-language"]?.split(",")[0]?.trim() as Language) ||
    DEFAULT_LANGUAGE;

  const result = await branchPortfolioService.getBranchPortfolio(
    branchId,
    query,
    language,
  );

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Branch portfolio retrieved successfully",
    data: result,
  });
});

const createBranchPortfolioCase = catchAsync(
  async (req: Request, res: Response) => {
    // =====================================================
    // 1. VALIDATE BRANCH ID
    // =====================================================

    const branchId = z.uuid().parse(req.params.branchId);

    // =====================================================
    // 2. VALIDATE REQUEST BODY
    // =====================================================

    const payload = z
      .object({
        title: z.string().trim().min(1).max(200),

        description: z.string().trim().nullable().optional(),

        serviceId: z.uuid().nullable().optional(),

        staffId: z.uuid().nullable().optional(),

        tags: z.array(z.string().trim().min(1)).max(30).optional(),

        translations: z
          .object({
            en: z
              .object({
                title: z.string().trim().min(1).optional(),
                description: z.string().optional(),
              })
              .optional(),

            "zh-CN": z
              .object({
                title: z.string().trim().min(1).optional(),
                description: z.string().optional(),
              })
              .optional(),

            "zh-HK": z
              .object({
                title: z.string().trim().min(1).optional(),
                description: z.string().optional(),
              })
              .optional(),
          })
          .optional(),

        sortOrder: z.number().int().min(0).optional(),
      })
      .strict()
      .parse(req.body);

    // =====================================================
    // 3. AUTHENTICATED REQUESTER
    // =====================================================

    const requester = {
      id: req.user!.userId,
      role: req.user!.role,
    };

    // =====================================================
    // 4. CREATE BRANCH PORTFOLIO CASE
    // =====================================================

    const result = await branchPortfolioService.createBranchPortfolioCase(
      branchId,
      requester,
      payload,
    );

    // =====================================================
    // 5. SEND RESPONSE
    // =====================================================

    sendResponse(res, {
      statusCode: 201,
      success: true,
      message: "Branch portfolio case created successfully",
      data: result,
    });
  },
);

const updateBranchPortfolioCase = catchAsync(
  async (req: Request, res: Response) => {
    // =====================================================
    // 1. VALIDATE PARAMS
    // =====================================================

    const branchId = z.uuid().parse(req.params.branchId);
    const caseId = z.uuid().parse(req.params.caseId);

    // =====================================================
    // 2. VALIDATE REQUEST BODY
    // =====================================================

    const translationFields = z
      .object({
        title: z.string().trim().min(1).optional(),
        description: z.string().optional(),
      })
      .strict();

    const payload = z
      .object({
        title: z.string().trim().min(1).max(200).optional(),

        description: z.string().trim().nullable().optional(),

        serviceId: z.uuid().nullable().optional(),

        staffId: z.uuid().nullable().optional(),

        tags: z.array(z.string().trim().min(1)).max(30).optional(),

        translations: z
          .object({
            en: translationFields.optional(),
            "zh-CN": translationFields.optional(),
            "zh-HK": translationFields.optional(),
          })
          .strict()
          .nullable()
          .optional(),

        sortOrder: z.number().int().min(0).optional(),

        status: z.nativeEnum(StaffPortfolioStatus).optional(),
      })
      .strict()
      .refine((data) => Object.keys(data).length > 0, {
        message: "At least one field is required",
      })
      .parse(req.body);

    // =====================================================
    // 3. AUTHENTICATED REQUESTER
    // =====================================================

    const requester = {
      id: req.user!.userId,
      role: req.user!.role,
    };

    // =====================================================
    // 4. UPDATE PORTFOLIO CASE
    // =====================================================

    const result = await branchPortfolioService.updateBranchPortfolioCase(
      branchId,
      caseId,
      requester,
      payload,
    );

    // =====================================================
    // 5. SEND RESPONSE
    // =====================================================

    sendResponse(res, {
      statusCode: 200,
      success: true,
      message: "Branch portfolio case updated successfully",
      data: result,
    });
  },
);

const addBranchPortfolioImages = catchAsync(
  async (req: Request, res: Response) => {
    // =====================================================
    // 1. VALIDATE ROUTE PARAMS
    // =====================================================

    const branchId = z.uuid().parse(req.params.branchId);
    const caseId = z.uuid().parse(req.params.caseId);

    // =====================================================
    // 2. VALIDATE REQUEST BODY
    // =====================================================

    const payload = z
      .object({
        images: z
          .array(
            z
              .object({
                objectKey: z.string().trim().min(1),
                isCover: z.boolean().optional(),
              })
              .strict(),
          )
          .min(1)
          .max(20),
      })
      .strict()
      .parse(req.body);

    // =====================================================
    // 3. AUTHENTICATED REQUESTER
    // =====================================================

    const requester = {
      id: req.user!.userId,
      role: req.user!.role,
    };

    // =====================================================
    // 4. ADD IMAGES
    // =====================================================

    const result = await branchPortfolioService.addBranchPortfolioImages(
      branchId,
      caseId,
      requester,
      payload,
    );

    // =====================================================
    // 5. SEND RESPONSE
    // =====================================================

    sendResponse(res, {
      statusCode: 201,
      success: true,
      message: "Branch portfolio images added successfully",
      data: result,
    });
  },
);

const reorderBranchPortfolioImages = catchAsync(
  async (req: Request, res: Response) => {
    // =====================================================
    // 1. VALIDATE ROUTE PARAMS
    // =====================================================

    const branchId = z.uuid().parse(req.params.branchId);
    const caseId = z.uuid().parse(req.params.caseId);

    // =====================================================
    // 2. VALIDATE REQUEST BODY
    // =====================================================

    const payload = z
      .object({
        imageIds: z.array(z.uuid()),

        coverImageId: z.uuid().optional(),
      })
      .strict()
      .parse(req.body);

    // =====================================================
    // 3. AUTHENTICATED REQUESTER
    // =====================================================

    const requester = {
      id: req.user!.userId,
      role: req.user!.role,
    };

    // =====================================================
    // 4. REORDER IMAGES
    // =====================================================

    const result = await branchPortfolioService.reorderBranchPortfolioImages(
      branchId,
      caseId,
      requester,
      payload,
    );

    // =====================================================
    // 5. SEND RESPONSE
    // =====================================================

    sendResponse(res, {
      statusCode: 200,
      success: true,
      message: "Branch portfolio images reordered successfully",
      data: result,
    });
  },
);

const deleteBranchPortfolioImage = catchAsync(
  async (req: Request, res: Response) => {
    // =====================================================
    // 1. VALIDATE ROUTE PARAMS
    // =====================================================

    const branchId = z.uuid().parse(req.params.branchId);
    const caseId = z.uuid().parse(req.params.caseId);
    const imageId = z.uuid().parse(req.params.imageId);

    // =====================================================
    // 2. AUTHENTICATED REQUESTER
    // =====================================================

    const requester = {
      id: req.user!.userId,
      role: req.user!.role,
    };

    // =====================================================
    // 3. DELETE IMAGE
    // =====================================================

    const result = await branchPortfolioService.deleteBranchPortfolioImage(
      branchId,
      caseId,
      imageId,
      requester,
    );

    // =====================================================
    // 4. SEND RESPONSE
    // =====================================================

    sendResponse(res, {
      statusCode: 200,
      success: true,
      message: "Branch portfolio image deleted successfully",
      data: result,
    });
  },
);

export const branchPortfolioController = {
  getBranchPortfolio,
  createBranchPortfolioCase,
  updateBranchPortfolioCase,
  addBranchPortfolioImages,
  reorderBranchPortfolioImages,
  deleteBranchPortfolioImage,
};
