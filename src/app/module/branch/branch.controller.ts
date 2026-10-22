import { Request, Response } from "express";

import httpStatus from "http-status";

import { catchAsync } from "../../utils/catchAsync.js";

import { sendResponse } from "../../utils/sendResponse.js";

import { branchService } from "./branch.service.js";
import { AppError } from "../../utils/app-error.js";
import { DEFAULT_LANGUAGE, isLanguage } from "../../utils/language.js";

const createBranch = catchAsync(async (req: Request, res: Response) => {
  const result = await branchService.createBranch(req.body);

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Branch created successfully",
    data: result,
  });
});

// =====================================================
// GET ALL BRANCHES
// =====================================================

const getBranches = catchAsync(async (req: Request, res: Response) => {
  const language = isLanguage(res.locals.language)
    ? res.locals.language
    : DEFAULT_LANGUAGE;

  const result = await branchService.getBranches(req.query, language);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Branches fetched successfully",
    data: result,
  });
});

const getNearbyBranches = catchAsync(async (req: Request, res: Response) => {
  const language = isLanguage(res.locals.language)
    ? res.locals.language
    : DEFAULT_LANGUAGE;

  const result = await branchService.getNearbyBranches(req.body, language);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Nearby branches fetched successfully",
    data: result,
  });
});

// =====================================================
// GET SINGLE BRANCH
// =====================================================

const getBranchById = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId as string;

  const language = isLanguage(res.locals.language)
    ? res.locals.language
    : DEFAULT_LANGUAGE;

  const result = await branchService.getBranchById(branchId, language);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Branch fetched successfully",
    data: result,
  });
});

// =====================================================
// UPDATE BRANCH
// =====================================================

const updateBranch = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId as string;

  const language = isLanguage(res.locals.language)
    ? res.locals.language
    : DEFAULT_LANGUAGE;

  const result = await branchService.updateBranch(branchId, req.body, language);

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
// =====================================================
// UPDATE BRANCH CANCELLATION POLICY
// =====================================================

const updateCancellationPolicy = catchAsync(
  async (req: Request, res: Response) => {
    const { branchId } = req.params;

    const userId = req.user!.userId;
    const role = req.user!.role;

    const result = await branchService.updateCancellationPolicy(
      branchId as string,
      req.body,
      userId,
      role,
    );

    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Branch cancellation policy updated successfully",
      data: result,
    });
  },
);
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
const getBranchDailySummary = catchAsync(
  async (req: Request, res: Response) => {
    // =====================================================
    // 1. AUTHENTICATION CHECK
    // =====================================================

    if (!req.user) {
      throw new AppError("Unauthorized", 401);
    }

    // =====================================================
    // 2. REQUEST PARAMETERS
    // =====================================================

    const branchId = req.params.branchId as string;

    const { date } = req.body as {
      date: string;
    };

    // =====================================================
    // 3. GET BRANCH DAILY SUMMARY
    // =====================================================

    const result = await branchService.getBranchDailySummary(
      branchId,
      req.user.userId,
      req.user.role,
      date,
    );

    // =====================================================
    // 4. SEND RESPONSE
    // =====================================================

    sendResponse(res, {
      success: true,
      statusCode: 200,
      message: "Branch daily summary fetched successfully",
      data: result,
    });
  },
);

const getBranchDailySeries = catchAsync(async (req: Request, res: Response) => {
  // =====================================================
  // 1. AUTHENTICATION CHECK
  // =====================================================

  if (!req.user) {
    throw new AppError("Unauthorized", 401);
  }

  // =====================================================
  // 2. REQUEST PARAMETERS
  // =====================================================

  const branchId = req.params.branchId as string;

  const { start, end } = req.body as {
    start: string;
    end: string;
  };

  // =====================================================
  // 3. GET DAILY SERIES
  // =====================================================

  const result = await branchService.getBranchDailySeries(
    branchId,
    req.user.userId,
    req.user.role,
    {
      start,
      end,
    },
  );

  // =====================================================
  // 4. SEND RESPONSE
  // =====================================================

  sendResponse(res, {
    success: true,
    statusCode: 200,
    message: "Branch daily series fetched successfully",
    data: result,
  });
});

const getBranchStaffOutput = catchAsync(async (req: Request, res: Response) => {
  // =====================================================
  // 1. AUTHENTICATION CHECK
  // =====================================================

  if (!req.user) {
    throw new AppError("Unauthorized", 401);
  }

  // =====================================================
  // 2. REQUEST PARAMETERS
  // =====================================================

  const branchId = req.params.branchId as string;

  const { start, end } = req.body as {
    start: string;
    end: string;
  };

  // =====================================================
  // 3. GET STAFF OUTPUT
  // =====================================================

  const result = await branchService.getBranchStaffOutput(
    branchId,
    req.user.userId,
    req.user.role,
    {
      start,
      end,
    },
  );

  // =====================================================
  // 4. SEND RESPONSE
  // =====================================================

  sendResponse(res, {
    success: true,
    statusCode: 200,
    message: "Branch staff output fetched successfully",
    data: result,
  });
});

// =====================================================
// GET BRANCH CANCELLATION POLICY
// =====================================================

const getCancellationPolicy = catchAsync(
  async (req: Request, res: Response) => {
    const { branchId } = req.params;

    const result = await branchService.getCancellationPolicy(
      branchId as string,
    );

    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Branch cancellation policy retrieved successfully",
      data: result,
    });
  },
);
export const branchController = {
  createBranch,
  getBranches,
  getNearbyBranches,
  getBranchById,
  updateBranch,
  updateBranchStatus,
  getBusinessHours,
  updateBusinessHours,
  getBookingPolicy,
  updateBookingPolicy,
  searchBranchCustomers,
  getBranchDailySummary,
  getBranchDailySeries,
  getBranchStaffOutput,
  updateCancellationPolicy,
  getCancellationPolicy,
};
