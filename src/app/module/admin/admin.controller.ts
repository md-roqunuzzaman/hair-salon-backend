import { Request, Response } from "express";
import httpStatus from "http-status";

import { catchAsync } from "../../utils/catchAsync.js";
import { sendResponse } from "../../utils/sendResponse.js";
import { adminUserService } from "./admin.service.js";
import { AppError } from "../../utils/app-error.js";

const getAdminUsers = catchAsync(async (req: Request, res: Response) => {
  const result = await adminUserService.getAdminUsers(req.body);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Users fetched successfully",
    data: result,
  });
});

const getAdminUserById = catchAsync(async (req: Request, res: Response) => {
  const userId = req.params.userId;

  if (!userId || Array.isArray(userId)) {
    throw new AppError("Invalid userId", 400);
  }

  const result = await adminUserService.getAdminUserById(userId);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "User fetched successfully",
    data: result,
  });
});

const updateAdminUserStatus = catchAsync(
  async (req: Request, res: Response) => {
    const userId = req.params.userId;

    if (!userId || Array.isArray(userId)) {
      throw new AppError("Invalid userId", 400);
    }

    const result = await adminUserService.updateAdminUserStatus(
      userId,
      req.body,
    );

    sendResponse(res, {
      success: true,
      statusCode: httpStatus.OK,
      message: "User status updated successfully",
      data: result,
    });
  },
);

export const adminUserController = {
  getAdminUsers,
  getAdminUserById,
  updateAdminUserStatus,
};
