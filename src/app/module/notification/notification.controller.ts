import { Request, Response } from "express";

import httpStatus from "http-status";

import { catchAsync } from "../../utils/catchAsync.js";
import { sendResponse } from "../../utils/sendResponse.js";

import { DEFAULT_LANGUAGE, type Language } from "../../utils/language.js";

import { notificationService } from "./notification.service.js";
import { AppError } from "../../utils/app-error.js";

// =====================================================
// GET NOTIFICATIONS
// =====================================================

const getNotifications = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user!.userId;

  // =====================================================
  // 1. RESOLVE REQUEST LANGUAGE
  // =====================================================

  const language =
    req.headers["accept-language"]?.split(",")[0]?.split(";")[0]?.trim() ??
    DEFAULT_LANGUAGE;

  const supportedLanguage: Language =
    language === "zh-CN" || language === "zh-HK" || language === "en"
      ? language
      : DEFAULT_LANGUAGE;

  // =====================================================
  // 2. FETCH LOCALIZED NOTIFICATIONS
  // =====================================================

  const result = await notificationService.getNotifications(
    userId,
    req.body,
    supportedLanguage,
  );

  // =====================================================
  // 3. RESPONSE
  // =====================================================

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Notifications fetched successfully",
    data: result,
  });
});

// =====================================================
// MARK NOTIFICATION AS READ — UNCHANGED
// =====================================================

const markAsRead = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user!.userId;

  const notificationId = req.params.notificationId;

  if (!notificationId || Array.isArray(notificationId)) {
    throw new AppError("Invalid notificationId", 400);
  }

  const result = await notificationService.markAsRead(userId, notificationId);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Notification marked as read successfully",
    data: result,
  });
});

// =====================================================
// MARK ALL NOTIFICATIONS AS READ — UNCHANGED
// =====================================================

const markAllAsRead = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user!.userId;

  await notificationService.markAllAsRead(userId);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "All notifications marked as read",
    data: null,
  });
});

// =====================================================
// EXPORT
// =====================================================

export const notificationController = {
  getNotifications,
  markAsRead,
  markAllAsRead,
};
