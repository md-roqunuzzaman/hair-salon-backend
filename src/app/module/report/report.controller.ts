import { Request, Response } from "express";

import httpStatus from "http-status";

import { catchAsync } from "../../utils/catchAsync.js";
import { sendResponse } from "../../utils/sendResponse.js";

import { reportService } from "./report.service.js";
import { DEFAULT_LANGUAGE, Language } from "../../utils/language.js";

const getBranchReport = catchAsync(async (req: Request, res: Response) => {
  const language =
    req.headers["accept-language"]?.split(",")[0]?.split(";")[0]?.trim() ??
    DEFAULT_LANGUAGE;

  const supportedLanguage: Language =
    language === "zh-CN" || language === "zh-HK" || language === "en"
      ? language
      : DEFAULT_LANGUAGE;

  const result = await reportService.getBranchReport(
    req.body,
    supportedLanguage,
  );

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
  const language =
    req.headers["accept-language"]?.split(",")[0]?.split(";")[0]?.trim() ??
    DEFAULT_LANGUAGE;

  const supportedLanguage: Language =
    language === "zh-CN" || language === "zh-HK" || language === "en"
      ? language
      : DEFAULT_LANGUAGE;

  const result = await reportService.getServiceReport(supportedLanguage);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Service report fetched successfully",
    data: result,
  });
});

const getPackageReport = catchAsync(async (req: Request, res: Response) => {
  const language =
    req.headers["accept-language"]?.split(",")[0]?.split(";")[0]?.trim() ??
    DEFAULT_LANGUAGE;

  const supportedLanguage: Language =
    language === "zh-CN" || language === "zh-HK" || language === "en"
      ? language
      : DEFAULT_LANGUAGE;

  const result = await reportService.getPackageReport(supportedLanguage);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Package report fetched successfully",
    data: result,
  });
});

const getGroupPurchaseReport = catchAsync(
  async (req: Request, res: Response) => {
    // =====================================================
    // 1. EXTRACT REQUEST LANGUAGE
    // =====================================================

    const language =
      req.headers["accept-language"]?.split(",")[0]?.split(";")[0]?.trim() ??
      DEFAULT_LANGUAGE;

    const supportedLanguage: Language =
      language === "zh-CN" || language === "zh-HK" || language === "en"
        ? language
        : DEFAULT_LANGUAGE;

    // =====================================================
    // 2. FETCH GROUP PURCHASE REPORT
    // =====================================================

    const result =
      await reportService.getGroupPurchaseReport(supportedLanguage);

    // =====================================================
    // 3. SEND RESPONSE
    // =====================================================

    sendResponse(res, {
      success: true,
      statusCode: httpStatus.OK,

      message: "Group purchase report fetched successfully",

      data: result,
    });
  },
);

const getStaffReport = catchAsync(async (req: Request, res: Response) => {
  // =====================================================
  // 1. EXTRACT REQUEST LANGUAGE
  // =====================================================

  const language =
    req.headers["accept-language"]?.split(",")[0]?.split(";")[0]?.trim() ??
    DEFAULT_LANGUAGE;

  const supportedLanguage: Language =
    language === "zh-CN" || language === "zh-HK" || language === "en"
      ? language
      : DEFAULT_LANGUAGE;

  // =====================================================
  // 2. FETCH STAFF REPORT
  // =====================================================

  const result = await reportService.getStaffReport(
    req.user!.userId,
    req.user!.role,
    req.query,
    supportedLanguage,
  );

  // =====================================================
  // 3. SEND RESPONSE
  // =====================================================

  sendResponse(res, {
    success: true,
    statusCode: 200,
    message: "Staff report fetched successfully",
    data: result,
  });
});

const getPaymentReport = catchAsync(async (req: Request, res: Response) => {
  const result = await reportService.getPaymentReport();

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Payment report fetched successfully",
    data: result,
  });
});

const getWalletReport = catchAsync(async (req: Request, res: Response) => {
  const result = await reportService.getWalletReport();

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Wallet report fetched successfully",
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
  getPaymentReport,
  getWalletReport,
};
