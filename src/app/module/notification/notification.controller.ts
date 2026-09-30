import { Request, Response } from "express";

import httpStatus from "http-status";

import { catchAsync } from "../../utils/catchAsync.js";
import { sendResponse } from "../../utils/sendResponse.js";

import { notificationService } from "./notification.service.js";
import { AppError } from "../../utils/app-error.js";

const getNotifications = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user!.userId;

  const result = await notificationService.getNotifications(userId, req.body);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Notifications fetched successfully",
    data: result,
  });
});

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

export const notificationController = {
  getNotifications,
  markAsRead,
  markAllAsRead,
};
