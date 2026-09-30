import { Request, Response } from "express";

import httpStatus from "http-status";

import { catchAsync } from "../../utils/catchAsync.js";
import { sendResponse } from "../../utils/sendResponse.js";

import { dashboardService } from "./dashboard.service.js";
import { AppError } from "../../utils/app-error.js";

const getBrandDashboard = catchAsync(async (req: Request, res: Response) => {
  const result = await dashboardService.getBrandDashboard(req.body);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,

    message: "Dashboard fetched successfully",

    data: result,
  });
});

const getBranchDashboard = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId;

  if (!branchId || Array.isArray(branchId)) {
    throw new AppError("Invalid branchId", 400);
  }

  const userId = req.user!.userId;

  const role = req.user!.role;

  const result = await dashboardService.getBranchDashboard(
    branchId,
    userId,
    role,
    req.body,
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,

    message: "Branch dashboard fetched successfully",

    data: result,
  });
});
export const dashboardController = {
  getBrandDashboard,
  getBranchDashboard,
};
