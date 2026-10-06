import { Request, Response } from "express";

import httpStatus from "http-status";

import { catchAsync } from "../../utils/catchAsync.js";

import { sendResponse } from "../../utils/sendResponse.js";

import { branchService } from "./branch.service.js";
import { AppError } from "../../utils/app-error.js";

const createBranch = catchAsync(async (req: Request, res: Response) => {
  const result = await branchService.createBranch(req.body);

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Branch created successfully",
    data: result,
  });
});
const getBranches = catchAsync(async (req: Request, res: Response) => {
  const result = await branchService.getBranches(req.query);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Branches fetched successfully",
    data: result,
  });
});

const getBranchById = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId as string;

  const result = await branchService.getBranchById(branchId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Branch fetched successfully",
    data: result,
  });
});

const updateBranch = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId as string;

  const result = await branchService.updateBranch(branchId, req.body);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Branch updated successfully",
    data: result,
  });
});

const updateBranchStatus = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId as string;

  const result = await branchService.updateBranchStatus(
    branchId,
    req.body,
    req.user!.userId,
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Branch status updated successfully",
    data: result,
  });
});

const getBusinessHours = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId as string;

  const result = await branchService.getBusinessHours(branchId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Business hours fetched successfully",
    data: result,
  });
});

const updateBusinessHours = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId as string;

  const result = await branchService.updateBusinessHours(branchId, req.body);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Business hours updated successfully",
    data: result,
  });
});

const getBookingPolicy = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId as string;

  const result = await branchService.getBookingPolicy(branchId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Booking policy fetched successfully",
    data: result,
  });
});

const updateBookingPolicy = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId as string;

  const result = await branchService.updateBookingPolicy(
    branchId,
    req.body,
    req.user!.userId,
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Booking policy updated successfully",
    data: result,
  });
});

const searchBranchCustomers = catchAsync(
  async (req: Request, res: Response) => {
    if (!req.user) {
      throw new AppError("AUTH_REQUIRED", 401);
    }

    const branchId = req.params.branchId;

    if (!branchId || Array.isArray(branchId)) {
      throw new AppError("Invalid branchId", 400);
    }

    const result = await branchService.searchBranchCustomers(
      branchId,
      req.user.userId,
      req.user.role,
      req.body,
    );

    sendResponse(res, {
      success: true,
      statusCode: httpStatus.OK,
      message: "Customers searched successfully",
      data: result,
    });
  },
);

export const branchController = {
  createBranch,
  getBranches,
  getBranchById,
  updateBranch,
  updateBranchStatus,
  getBusinessHours,
  updateBusinessHours,
  getBookingPolicy,
  updateBookingPolicy,
  searchBranchCustomers,
};
