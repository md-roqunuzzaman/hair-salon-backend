import { Request, Response } from "express";

import httpStatus from "http-status";

import { catchAsync } from "../../utils/catchAsync.js";
import { sendResponse } from "../../utils/sendResponse.js";

import { promotionService } from "./promotion.service.js";
import { AppError } from "../../utils/app-error.js";

const createPromotion = catchAsync(async (req: Request, res: Response) => {
  const result = await promotionService.createPromotion(req.body);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.CREATED,
    message: "Promotion created successfully",
    data: result,
  });
});

const getPromotions = catchAsync(async (req: Request, res: Response) => {
  const role = req.user!.role;

  const result = await promotionService.getPromotions(role);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Promotions fetched successfully",
    data: result,
  });
});

const getPromotionById = catchAsync(async (req: Request, res: Response) => {
  const promotionId = req.params.promotionId;

  if (!promotionId || Array.isArray(promotionId)) {
    throw new AppError("Invalid promotionId", 400);
  }

  const result = await promotionService.getPromotionById(promotionId);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Promotion fetched successfully",
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
