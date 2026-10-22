import { Request, Response } from "express";

import httpStatus from "http-status";

import { catchAsync } from "../../utils/catchAsync.js";

import { sendResponse } from "../../utils/sendResponse.js";

import { packageService } from "./package.service.js";

import { DEFAULT_LANGUAGE, isLanguage } from "../../utils/language.js";

// =====================================================
// 1. CREATE PACKAGE
// =====================================================

const createPackage = catchAsync(async (req: Request, res: Response) => {
  const result = await packageService.createPackage(req.body);

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Package created successfully",
    data: result,
  });
});

// =====================================================
// 2. GET ALL PACKAGES - MULTILINGUAL
// =====================================================

const getPackages = catchAsync(async (req: Request, res: Response) => {
  const language = isLanguage(res.locals.language)
    ? res.locals.language
    : DEFAULT_LANGUAGE;

  const result = await packageService.getPackages(req.query, language);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Packages fetched successfully",
    data: result,
  });
});

// =====================================================
// 3. GET SINGLE PACKAGE - MULTILINGUAL
// =====================================================

const getPackageById = catchAsync(async (req: Request, res: Response) => {
  const packageId = req.params.packageId as string;

  const language = isLanguage(res.locals.language)
    ? res.locals.language
    : DEFAULT_LANGUAGE;

  const result = await packageService.getPackageById(packageId, language);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Package fetched successfully",
    data: result,
  });
});

// =====================================================
// 4. UPDATE PACKAGE - MULTILINGUAL
// =====================================================

const updatePackage = catchAsync(async (req: Request, res: Response) => {
  const packageId = req.params.packageId as string;

  const language = isLanguage(res.locals.language)
    ? res.locals.language
    : DEFAULT_LANGUAGE;

  const result = await packageService.updatePackage(
    packageId,
    req.body,
    language,
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Package updated successfully",
    data: result,
  });
});

// =====================================================
// 5. UPDATE PACKAGE STATUS
// =====================================================

const updatePackageStatus = catchAsync(async (req: Request, res: Response) => {
  const packageId = req.params.packageId as string;

  const result = await packageService.updatePackageStatus(
    packageId,
    req.body,
    req.user!.userId,
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Package status updated successfully",
    data: result,
  });
});

// =====================================================
// 6. UPDATE PACKAGE LISTING
// =====================================================

const updatePackageListing = catchAsync(async (req: Request, res: Response) => {
  const packageId = req.params.packageId as string;

  const result = await packageService.updatePackageListing(
    packageId,
    req.body,
    req.user!.userId,
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Package listing updated successfully",
    data: result,
  });
});

// =====================================================
// 7. ASSIGN PACKAGE TO BRANCHES
// =====================================================

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

// =====================================================
// 8. GET BRANCH PACKAGES - MULTILINGUAL
// =====================================================

const getBranchPackages = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId as string;

  const language = isLanguage(res.locals.language)
    ? res.locals.language
    : DEFAULT_LANGUAGE;

  const result = await packageService.getBranchPackages(
    branchId,
    req.query,
    language,
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Branch packages fetched successfully",
    data: result,
  });
});

// =====================================================
// UPDATE GROUP PURCHASE REFUND POLICY
// =====================================================

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
