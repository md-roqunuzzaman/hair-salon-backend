import { Request, Response } from "express";

import httpStatus from "http-status";

import { catchAsync } from "../../utils/catchAsync.js";
import { sendResponse } from "../../utils/sendResponse.js";

import { reportService } from "./report.service.js";

const getBranchReport = catchAsync(async (req: Request, res: Response) => {
  const result = await reportService.getBranchReport(req.body);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,

    message: "Branch report fetched successfully",

    data: result,
  });
});

const getBookingConversionReport = catchAsync(
  async (req: Request, res: Response) => {
    const result = await reportService.getBookingConversionReport(
      req.body,
      req.user!.userId,
      req.user!.role,
    );

    sendResponse(res, {
      success: true,
      statusCode: httpStatus.OK,

      message: "Booking conversion report fetched successfully",

      data: result,
    });
  },
);

const getServiceReport = catchAsync(async (req: Request, res: Response) => {
  const result = await reportService.getServiceReport();

  sendResponse(res, {
    success: true,
    statusCode: 200,
    message: "Service report fetched successfully",
    data: result,
  });
});

const getPackageReport = catchAsync(async (req: Request, res: Response) => {
  const result = await reportService.getPackageReport();

  sendResponse(res, {
    success: true,
    statusCode: 200,
    message: "Package report fetched successfully",
    data: result,
  });
});

const getGroupPurchaseReport = catchAsync(
  async (req: Request, res: Response) => {
    const result = await reportService.getGroupPurchaseReport();

    sendResponse(res, {
      success: true,
      statusCode: 200,
      message: "Group purchase report fetched successfully",
      data: result,
    });
  },
);

const getStaffReport = catchAsync(async (req: Request, res: Response) => {
  const result = await reportService.getStaffReport(
    req.user!.userId,
    req.user!.role,
    req.query,
  );

  sendResponse(res, {
    success: true,
    statusCode: 200,
    message: "Staff report fetched successfully",
    data: result,
  });
});
export const reportController = {
  getBranchReport,
  getBookingConversionReport,
  getServiceReport,
  getPackageReport,
  getGroupPurchaseReport,
  getStaffReport,
};
