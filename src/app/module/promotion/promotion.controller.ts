import { Request, Response } from "express";

import httpStatus from "http-status";

import { catchAsync } from "../../utils/catchAsync.js";
import { sendResponse } from "../../utils/sendResponse.js";

import { promotionService } from "./promotion.service.js";
import { AppError } from "../../utils/app-error.js";
import { Role } from "../../../../generated/prisma/enums.js";
import z from "zod";
import { DEFAULT_LANGUAGE, isLanguage } from "../../utils/language.js";

const createPromotion = catchAsync(async (req: Request, res: Response) => {
  const result = await promotionService.createPromotion(req.body);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.CREATED,
    message: "Promotion created successfully",
    data: result,
  });
});

// =====================================================
// GET PROMOTIONS
// =====================================================

const getPromotions = catchAsync(async (req: Request, res: Response) => {
  // =====================================================
  // 1. AUTHENTICATED USER ROLE
  // =====================================================

  const role = req.user!.role as Role;

  // =====================================================
  // 2. VALIDATE BRANCH ID
  // =====================================================

  const branchId =
    typeof req.query.branchId === "string" ? req.query.branchId : undefined;

  if (
    req.query.branchId !== undefined &&
    (!branchId || !z.uuid().safeParse(branchId).success)
  ) {
    throw new AppError("Invalid branchId", 400);
  }

  // =====================================================
  // 3. GET REQUEST LANGUAGE
  // =====================================================

  const language = isLanguage(res.locals.language)
    ? res.locals.language
    : DEFAULT_LANGUAGE;

  // =====================================================
  // 4. FETCH LOCALIZED PROMOTIONS
  // =====================================================

  const result = await promotionService.getPromotions(role, branchId, language);

  // =====================================================
  // 5. SEND RESPONSE
  // =====================================================

  sendResponse(res, {
    success: true,
    statusCode: 200,
    message: "Promotions retrieved successfully",
    data: result,
  });
});

// =====================================================
// GET SINGLE PROMOTION
// =====================================================

const getPromotionById = catchAsync(async (req: Request, res: Response) => {
  const role = req.user!.role as Role;

  // =====================================================
  // 1. VALIDATE PROMOTION ID
  // =====================================================

  const promotionId = req.params.promotionId;

  if (
    typeof promotionId !== "string" ||
    !z.string().uuid().safeParse(promotionId).success
  ) {
    throw new AppError("Invalid promotionId", 400);
  }

  // =====================================================
  // 2. VALIDATE BRANCH ID
  // =====================================================

  const rawBranchId = req.query.branchId;

  if (
    rawBranchId !== undefined &&
    (typeof rawBranchId !== "string" ||
      !z.string().uuid().safeParse(rawBranchId).success)
  ) {
    throw new AppError("Invalid branchId", 400);
  }

  const branchId = typeof rawBranchId === "string" ? rawBranchId : undefined;

  // =====================================================
  // 3. GET REQUEST LANGUAGE
  // =====================================================

  const language = isLanguage(res.locals.language)
    ? res.locals.language
    : DEFAULT_LANGUAGE;

  // =====================================================
  // 4. FETCH LOCALIZED PROMOTION
  // =====================================================

  const result = await promotionService.getPromotionById(
    promotionId,
    role,
    branchId,
    language,
  );

  // =====================================================
  // 5. SEND RESPONSE
  // =====================================================

  sendResponse(res, {
    success: true,
    statusCode: 200,
    message: "Promotion retrieved successfully",
    data: result,
  });
});

const updatePromotion = catchAsync(async (req: Request, res: Response) => {
  const promotionId = req.params.promotionId;

  if (!promotionId || Array.isArray(promotionId)) {
    throw new AppError("Invalid promotionId", 400);
  }

  const result = await promotionService.updatePromotion(promotionId, req.body);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Promotion updated successfully",
    data: result,
  });
});

const updatePromotionStatus = catchAsync(
  async (req: Request, res: Response) => {
    const promotionId = req.params.promotionId;

    if (!promotionId || Array.isArray(promotionId)) {
      throw new AppError("Invalid promotionId", 400);
    }

    const result = await promotionService.updatePromotionStatus(
      promotionId,
      req.body.status,
    );

    sendResponse(res, {
      success: true,
      statusCode: httpStatus.OK,
      message: "Promotion status updated successfully",
      data: result,
    });
  },
);

export const promotionController = {
  createPromotion,
  getPromotions,
  getPromotionById,
  updatePromotion,
  updatePromotionStatus,
};
