import { Request, Response } from "express";

import httpStatus from "http-status";

import { catchAsync } from "../../utils/catchAsync.js";

import { sendResponse } from "../../utils/sendResponse.js";

import { packageService } from "./package.service.js";

const createPackage = catchAsync(async (req: Request, res: Response) => {
  const result = await packageService.createPackage(req.body);

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Package created successfully",
    data: result,
  });
});

const getPackages = catchAsync(async (req: Request, res: Response) => {
  const result = await packageService.getPackages(req.query);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Packages fetched successfully",
    data: result,
  });
});

const getPackageById = catchAsync(async (req: Request, res: Response) => {
  const packageId = req.params.packageId as string;

  const result = await packageService.getPackageById(packageId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Package fetched successfully",
    data: result,
  });
});

const updatePackage = catchAsync(async (req: Request, res: Response) => {
  const packageId = req.params.packageId as string;

  const result = await packageService.updatePackage(packageId, req.body);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Package updated successfully",
    data: result,
  });
});

const updatePackageStatus = catchAsync(async (req: Request, res: Response) => {
  const packageId = req.params.packageId as string;

  const result = await packageService.updatePackageStatus(packageId, req.body);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Package status updated successfully",
    data: result,
  });
});

const updatePackageListing = catchAsync(async (req: Request, res: Response) => {
  const packageId = req.params.packageId as string;

  const result = await packageService.updatePackageListing(packageId, req.body);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Package listing updated successfully",
    data: result,
  });
});

const assignPackageToBranches = catchAsync(
  async (req: Request, res: Response) => {
    const packageId = req.params.packageId as string;

    const result = await packageService.assignPackageToBranches(
      packageId,
      req.body,
    );

    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Package branches updated successfully",
      data: result,
    });
  },
);

const getBranchPackages = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId as string;

  const result = await packageService.getBranchPackages(branchId, req.query);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Branch packages fetched successfully",
    data: result,
  });
});

export const packageController = {
  createPackage,
  getPackages,
  getPackageById,
  updatePackage,
  updatePackageStatus,
  updatePackageListing,
  assignPackageToBranches,
  getBranchPackages,
};
