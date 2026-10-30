import { Request, Response } from "express";

import httpStatus from "http-status";

import { catchAsync } from "../../utils/catchAsync.js";
import { sendResponse } from "../../utils/sendResponse.js";

import { DEFAULT_LANGUAGE, isLanguage } from "../../utils/language.js";

import { notificationService } from "./notification.service.js";
import { AppError } from "../../utils/app-error.js";

const responseCopy = {
  en: { fetched: 'Notifications fetched successfully', read: 'Notification marked as read successfully', allRead: 'All notifications marked as read' },
  'zh-CN': { fetched: '通知获取成功', read: '通知已标记为已读', allRead: '所有通知已标记为已读' },
  'zh-HK': { fetched: '通知獲取成功', read: '通知已標記為已讀', allRead: '所有通知已標記為已讀' },
};
const copy = (res: Response) => responseCopy[isLanguage(res.locals.language) ? res.locals.language : DEFAULT_LANGUAGE];

// =====================================================
// GET NOTIFICATIONS
// =====================================================

const getNotifications = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user!.userId;

  // =====================================================
  // 1. RESOLVE REQUEST LANGUAGE
  // =====================================================

  const language = isLanguage(res.locals.language) ? res.locals.language : DEFAULT_LANGUAGE;

  // =====================================================
  // 2. FETCH LOCALIZED NOTIFICATIONS
  // =====================================================

  const result = await notificationService.getNotifications(
    userId,
    req.body,
    language,
  );

  // =====================================================
  // 3. RESPONSE
  // =====================================================

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: copy(res).fetched,
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
    message: copy(res).read,
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
    message: copy(res).allRead,
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
