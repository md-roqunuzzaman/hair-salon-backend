import { Request, Response } from "express";
import httpStatus from "http-status";

import { catchAsync } from "../../utils/catchAsync.js";
import { sendResponse } from "../../utils/sendResponse.js";
import { AppError } from "../../utils/app-error.js";

import { branchHourlyCapacityService } from "./branch-hourly-capacity.service.js";

const getBranchHourlyCapacity = catchAsync(
  async (req: Request, res: Response) => {
    const branchId = req.params.branchId;

    if (!branchId || Array.isArray(branchId)) {
      throw new AppError("Invalid branchId", httpStatus.BAD_REQUEST);
    }

    const result = await branchHourlyCapacityService.getBranchHourlyCapacity(
      branchId,
      {
        userId: req.user!.userId,
        role: req.user!.role,
      },
    );

    sendResponse(res, {
      success: true,
      statusCode: httpStatus.OK,
      message: "Branch hourly capacity fetched successfully",
      data: result,
    });
  },
);

const updateBranchHourlyCapacity = catchAsync(
  async (req: Request, res: Response) => {
    const branchId = req.params.branchId;

    if (!branchId || Array.isArray(branchId)) {
      throw new AppError("Invalid branchId", httpStatus.BAD_REQUEST);
    }

    const result = await branchHourlyCapacityService.updateBranchHourlyCapacity(
      branchId,
      req.body,
      {
        userId: req.user!.userId,
        role: req.user!.role,
      },
    );

    sendResponse(res, {
      success: true,
      statusCode: httpStatus.OK,
      message: "Branch hourly capacity updated successfully",
      data: result,
    });
  },
);

export const branchHourlyCapacityController = {
  getBranchHourlyCapacity,
  updateBranchHourlyCapacity,
};
