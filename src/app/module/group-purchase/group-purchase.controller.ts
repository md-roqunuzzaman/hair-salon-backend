import { Request, Response } from "express";

import httpStatus from "http-status";

import { catchAsync } from "../../utils/catchAsync.js";

import { sendResponse } from "../../utils/sendResponse.js";

import { groupPurchaseService } from "./group-purchase.service.js";
import { DEFAULT_LANGUAGE, isLanguage } from "../../utils/language.js";
import { AppError } from "../../utils/app-error.js";

const createGroupPurchase = catchAsync(async (req: Request, res: Response) => {
  const customerId = req.user!.userId;

  const result = await groupPurchaseService.createGroupPurchase(
    customerId,
    req.body,
  );

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Group purchase started successfully",
    data: result,
  });
});

const getMyGroupPurchases = catchAsync(async (req: Request, res: Response) => {
  const customerId = req.user!.userId;

  // =====================================================
  // 1. GET REQUEST LANGUAGE
  // =====================================================

  const language = isLanguage(res.locals.language)
    ? res.locals.language
    : DEFAULT_LANGUAGE;

  // =====================================================
  // 2. FETCH LOCALIZED GROUP PURCHASES
  // =====================================================

  const result = await groupPurchaseService.getMyGroupPurchases(
    customerId,
    req.query,
    language,
  );

  // =====================================================
  // 3. RESPONSE
  // =====================================================

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Group purchases fetched successfully",
    data: result,
  });
});

const getGroupPurchaseById = catchAsync(async (req: Request, res: Response) => {
  // =====================================================
  // 1. AUTHENTICATED USER
  // =====================================================

  const userId = req.user!.userId;
  const role = req.user!.role;

  const purchaseId = req.params.purchaseId as string;

  // =====================================================
  // 2. GET REQUEST LANGUAGE
  // =====================================================

  const language = isLanguage(res.locals.language)
    ? res.locals.language
    : DEFAULT_LANGUAGE;

  // =====================================================
  // 3. FETCH LOCALIZED GROUP PURCHASE DETAILS
  // =====================================================

  const result = await groupPurchaseService.getGroupPurchaseById(
    purchaseId,
    userId,
    role,
    language,
  );

  // =====================================================
  // 4. RESPONSE
  // =====================================================

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Group purchase fetched successfully",
    data: result,
  });
});

const createGroupPurchaseAppointment = catchAsync(
  async (req: Request, res: Response) => {
    const customerId = req.user!.userId;

    const { purchaseId } = req.params;

    const result = await groupPurchaseService.createGroupPurchaseAppointment(
      customerId,
      purchaseId as string,
      req.body,
    );

    sendResponse(res, {
      statusCode: 201,
      success: true,
      message: "Group purchase appointment booked successfully",
      data: result,
    });
  },
);

const recordGroupPurchaseRemainingPayment = catchAsync(
  async (req: Request, res: Response) => {
    // =====================================================
    // 1. VALIDATE AUTHENTICATED USER
    // =====================================================

    const user = req.user;

    if (!user) {
      throw new AppError("Unauthorized", 401);
    }

    // =====================================================
    // 2. VALIDATE PURCHASE ID
    // =====================================================

    const purchaseId = req.params.purchaseId;

    if (typeof purchaseId !== "string" || !purchaseId.trim()) {
      throw new AppError("Valid purchase ID is required", 400);
    }

    // =====================================================
    // 3. RECORD REMAINING PAYMENT
    // =====================================================

    const result =
      await groupPurchaseService.recordGroupPurchaseRemainingPayment(
        purchaseId,
        req.body,
        user.userId,
        user.role,
      );

    // =====================================================
    // 4. SEND RESPONSE
    // =====================================================

    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Group purchase remaining payment recorded successfully",
      data: result,
    });
  },
);

export const groupPurchaseController = {
  createGroupPurchase,
  getMyGroupPurchases,
  getGroupPurchaseById,
  createGroupPurchaseAppointment,
  recordGroupPurchaseRemainingPayment,
};
