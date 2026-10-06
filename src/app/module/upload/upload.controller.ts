import { Request, Response } from "express";
import httpStatus from "http-status";

import { catchAsync } from "../../utils/catchAsync.js";
import { sendResponse } from "../../utils/sendResponse.js";

import { uploadService } from "./upload.service.js";

// =====================================================
// PRESIGN IMAGE UPLOAD
// =====================================================

const presignImageUpload = catchAsync(async (req: Request, res: Response) => {
  const result = await uploadService.presignImageUpload(req.body, {
    userId: req.user!.userId,
    role: req.user!.role,
  });

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Image upload URL generated successfully",
    data: result,
  });
});

// =====================================================
// CONFIRM IMAGE UPLOAD
// =====================================================

const confirmImageUpload = catchAsync(async (req: Request, res: Response) => {
  const result = await uploadService.confirmImageUpload(req.body, {
    userId: req.user!.userId,
    role: req.user!.role,
  });

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Image upload confirmed successfully",
    data: result,
  });
});

const deleteImage = catchAsync(async (req: Request, res: Response) => {
  const result = await uploadService.deleteImage(req.body, {
    userId: req.user!.userId,
    role: req.user!.role,
  });

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Image deleted successfully",
    data: result,
  });
});

// =====================================================
// EXPORT
// =====================================================

export const uploadController = {
  presignImageUpload,
  confirmImageUpload,
  deleteImage,
};
