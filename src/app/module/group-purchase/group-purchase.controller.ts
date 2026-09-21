import { Request, Response } from "express";

import httpStatus from "http-status";

import { catchAsync } from "../../utils/catchAsync.js";

import { sendResponse } from "../../utils/sendResponse.js";

import { groupPurchaseService } from "./group-purchase.service.js";

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

  const result = await groupPurchaseService.getMyGroupPurchases(
    customerId,
    req.query,
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Group purchases fetched successfully",
    data: result,
  });
});

const getGroupPurchaseById = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const role = req.user!.role;

  const purchaseId = req.params.purchaseId as string;

  const result = await groupPurchaseService.getGroupPurchaseById(
    purchaseId,
    userId,
    role,
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Group purchase fetched successfully",
    data: result,
  });
});
export const groupPurchaseController = {
  createGroupPurchase,
  getMyGroupPurchases,
  getGroupPurchaseById,
};
