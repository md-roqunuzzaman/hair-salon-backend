import { Request, Response } from "express";

import { catchAsync } from "../../utils/catchAsync.js";
import { sendResponse } from "../../utils/sendResponse.js";
import { AppError } from "../../utils/app-error.js";

import { RefundRequestService } from "./refund-request.service.js";
import { RefundRequestStatus } from "../../../../generated/prisma/enums.js";
import { RefundRequestProcessingService } from "./refund-request.processing.js";

const createRefundRequest = catchAsync(async (req: Request, res: Response) => {
  // =====================================================
  // 1. GET AUTHENTICATED CUSTOMER
  // =====================================================

  const customerId = req.user?.userId;

  if (!customerId) {
    throw new AppError("UNAUTHORIZED", 401);
  }

  // =====================================================
  // 2. CREATE REFUND REQUEST
  // =====================================================

  const result = await RefundRequestService.createRefundRequest(
    customerId,
    req.body,
  );

  // =====================================================
  // 3. SEND RESPONSE
  // =====================================================

  sendResponse(res, {
    success: true,
    statusCode: 201,
    message: "Refund request submitted successfully",
    data: result,
  });
});

const getMyRefundRequests = catchAsync(async (req: Request, res: Response) => {
  // =====================================================
  // 1. GET AUTHENTICATED CUSTOMER
  // =====================================================

  const customerId = req.user?.userId;

  if (!customerId) {
    throw new AppError("UNAUTHORIZED", 401);
  }

  // =====================================================
  // 2. FETCH CUSTOMER REFUND REQUESTS
  // =====================================================

  const result = await RefundRequestService.getMyRefundRequests(customerId);

  // =====================================================
  // 3. SEND RESPONSE
  // =====================================================

  sendResponse(res, {
    success: true,
    statusCode: 200,
    message: "Refund requests retrieved successfully",
    data: result,
  });
});

const getRefundRequests = catchAsync(async (req: Request, res: Response) => {
  const page = Number(req.query.page ?? 1);
  const limit = Number(req.query.limit ?? 20);

  const status = req.query.status as RefundRequestStatus | undefined;

  const result = await RefundRequestService.getRefundRequests({
    page,
    limit,
    status,
  });

  sendResponse(res, {
    success: true,
    statusCode: 200,
    message: "Refund requests retrieved successfully",
    data: result,
  });
});

const reviewRefundRequest = catchAsync(async (req: Request, res: Response) => {
  const reviewerId = req.user?.userId;

  if (!reviewerId) {
    throw new AppError("UNAUTHORIZED", 401);
  }

  const requestId = String(req.params.id);

  const result = await RefundRequestService.reviewRefundRequest(
    requestId,
    reviewerId,
    req.body,
  );

  sendResponse(res, {
    success: true,
    statusCode: 200,
    message: "Refund request reviewed successfully",
    data: result,
  });
});

const processApprovedRefund = catchAsync(async (req, res) => {
  const requestId = req.params.id as string;
  const reviewerId = req.user?.userId;

  if (!reviewerId) {
    throw new AppError("UNAUTHORIZED", 401);
  }

  const result = await RefundRequestProcessingService.processApprovedRefund(
    requestId,
    reviewerId,
  );

  sendResponse(res, {
    statusCode: result.status === "PROCESSING" ? 202 : 200,
    success: true,
    message:
      result.status === "PROCESSING"
        ? "Refund processing is pending"
        : "Refund processed successfully",
    data: result,
  });
});

const getRefundRequestById = catchAsync(async (req: Request, res: Response) => {
  const requestId = req.params.id as string;

  const userId = req.user?.userId;
  const role = req.user?.role;

  if (!userId || !role) {
    throw new AppError("UNAUTHORIZED", 401);
  }

  const result = await RefundRequestService.getRefundRequestById(
    requestId,
    userId,
    role,
  );

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Refund request retrieved successfully",
    data: result,
  });
});

export const RefundRequestController = {
  createRefundRequest,
  getMyRefundRequests,
  getRefundRequests,
  reviewRefundRequest,
  processApprovedRefund,
  getRefundRequestById,
};
