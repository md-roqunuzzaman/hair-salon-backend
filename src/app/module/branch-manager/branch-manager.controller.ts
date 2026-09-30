import { Request, Response } from "express";

import httpStatus from "http-status";

import { catchAsync } from "../../utils/catchAsync.js";
import { sendResponse } from "../../utils/sendResponse.js";

import { branchManagerService } from "./branch-manager.service.js";
import { AppError } from "../../utils/app-error.js";

const createBranchManager = catchAsync(async (req: Request, res: Response) => {
  const result = await branchManagerService.createBranchManager(req.body);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.CREATED,

    message: "Branch manager created successfully",

    data: result,
  });
});

const getBranchManagers = catchAsync(async (req: Request, res: Response) => {
  const result = await branchManagerService.getBranchManagers();

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Branch managers fetched successfully",
    data: result,
  });
});

const getBranchManagerById = catchAsync(async (req: Request, res: Response) => {
  const managerId = req.params.managerId;

  if (!managerId || Array.isArray(managerId)) {
    throw new AppError("Invalid managerId", 400);
  }

  const result = await branchManagerService.getBranchManagerById(managerId);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Branch manager fetched successfully",
    data: result,
  });
});

const updateBranchManagerBranches = catchAsync(
  async (req: Request, res: Response) => {
    const managerId = req.params.managerId;

    if (!managerId || Array.isArray(managerId)) {
      throw new AppError("Invalid managerId", 400);
    }

    const result = await branchManagerService.updateBranchManagerBranches(
      managerId,
      req.body,
    );

    sendResponse(res, {
      success: true,
      statusCode: httpStatus.OK,
      message: "Branch manager branches updated successfully",
      data: result,
    });
  },
);

const updateBranchManagerStatus = catchAsync(
  async (req: Request, res: Response) => {
    const managerId = req.params.managerId;

    if (!managerId || Array.isArray(managerId)) {
      throw new AppError("Invalid managerId", 400);
    }

    const result = await branchManagerService.updateBranchManagerStatus(
      managerId,
      req.body,
    );

    sendResponse(res, {
      success: true,
      statusCode: httpStatus.OK,
      message: "Branch manager status updated successfully",
      data: result,
    });
  },
);

export const branchManagerController = {
  createBranchManager,
  getBranchManagers,
  getBranchManagerById,
  updateBranchManagerBranches,
  updateBranchManagerStatus,
};
