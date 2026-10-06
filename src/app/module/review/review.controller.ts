import { Request, Response } from "express";

import httpStatus from "http-status";

import { AppError } from "../../utils/app-error.js";
import { catchAsync } from "../../utils/catchAsync.js";
import { sendResponse } from "../../utils/sendResponse.js";

import { reviewService } from "./review.service.js";

const createReview = catchAsync(async (req: Request, res: Response) => {
  const customerId = req.user!.userId;

  const appointmentId = req.params.appointmentId;

  if (!appointmentId || Array.isArray(appointmentId)) {
    throw new AppError("Invalid appointmentId", 400);
  }

  const result = await reviewService.createReview(
    customerId,
    appointmentId,
    req.body,
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.CREATED,
    message: "Review created successfully",
    data: result,
  });
});

const getBranchReviews = catchAsync(async (req: Request, res: Response) => {
  const branchId = req.params.branchId;

  if (!branchId || Array.isArray(branchId)) {
    throw new AppError("Invalid branchId", 400);
  }

  const result = await reviewService.getBranchReviews(branchId, req.body);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Branch reviews fetched successfully",
    data: result,
  });
});

const getStaffReviews = catchAsync(async (req: Request, res: Response) => {
  const staffId = req.params.staffId;

  if (!staffId || Array.isArray(staffId)) {
    throw new AppError("Invalid staffId", 400);
  }

  const result = await reviewService.getStaffReviews(staffId, req.body);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Staff reviews fetched successfully",
    data: result,
  });
});

const getMyReviews = catchAsync(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError("AUTH_REQUIRED", 401);
  }

  const result = await reviewService.getMyReviews(req.user.userId, req.body);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "My reviews fetched successfully",
    data: result,
  });
});

const updateReview = catchAsync(async (req: Request, res: Response) => {
  const customerId = req.user!.userId;

  const reviewId = req.params.reviewId;

  if (!reviewId || Array.isArray(reviewId)) {
    throw new AppError("Invalid reviewId", 400);
  }

  const result = await reviewService.updateReview(
    customerId,
    reviewId,
    req.body,
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Review updated successfully",
    data: result,
  });
});

const deleteReview = catchAsync(async (req: Request, res: Response) => {
  const customerId = req.user!.userId;

  const reviewId = req.params.reviewId;

  if (!reviewId || Array.isArray(reviewId)) {
    throw new AppError("Invalid reviewId", 400);
  }

  await reviewService.deleteReview(customerId, reviewId);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Review deleted successfully",
    data: null,
  });
});

const moderateReview = catchAsync(async (req: Request, res: Response) => {
  const reviewId = req.params.reviewId;

  if (!reviewId || Array.isArray(reviewId)) {
    throw new AppError("Invalid reviewId", 400);
  }

  const result = await reviewService.moderateReview(
    reviewId,
    req.user!.userId,
    req.body,
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Review moderation updated successfully",
    data: result,
  });
});

const saveReviewReply = catchAsync(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError("AUTH_REQUIRED", 401);
  }

  const reviewId = req.params.reviewId;

  if (!reviewId || Array.isArray(reviewId)) {
    throw new AppError("Invalid reviewId", 400);
  }

  const result = await reviewService.saveReviewReply(
    reviewId,
    req.user.userId,
    req.user.role,
    req.body,
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Review reply saved successfully",
    data: result,
  });
});

const deleteReviewReply = catchAsync(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError("AUTH_REQUIRED", 401);
  }

  const reviewId = req.params.reviewId;

  if (!reviewId || Array.isArray(reviewId)) {
    throw new AppError("Invalid reviewId", 400);
  }

  await reviewService.deleteReviewReply(
    reviewId,
    req.user.userId,
    req.user.role,
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Review reply deleted successfully",
    data: null,
  });
});

export const reviewController = {
  createReview,
  getBranchReviews,
  getStaffReviews,
  getMyReviews,
  updateReview,
  deleteReview,
  moderateReview,
  saveReviewReply,
  deleteReviewReply,
};
