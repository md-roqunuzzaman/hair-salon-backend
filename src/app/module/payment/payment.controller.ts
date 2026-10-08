import { Request, Response } from "express";
import httpStatus from "http-status";

import { catchAsync } from "../../utils/catchAsync.js";
import { sendResponse } from "../../utils/sendResponse.js";
import { paymentService } from "./payment.service.js";
import { AppError } from "../../utils/app-error.js";
import { walletService } from "../wallet/wallet.service.js";

const createStripeIntent = catchAsync(async (req: Request, res: Response) => {
  const customerId = req.user!.userId;

  const result = await paymentService.createStripeIntent(customerId, req.body);

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Stripe PaymentIntent created successfully",
    data: result,
  });
});

const stripeWebhook = catchAsync(async (req: Request, res: Response) => {
  const signature = req.headers["stripe-signature"];

  if (!signature || Array.isArray(signature)) {
    throw new AppError("Stripe signature is missing", 400);
  }

  if (!Buffer.isBuffer(req.body)) {
    throw new AppError("Invalid Stripe webhook payload", 400);
  }

  const result = await paymentService.handleStripeWebhook(req.body, signature);

  res.status(httpStatus.OK).json(result);
});

const getPaymentById = catchAsync(async (req: Request, res: Response) => {
  const paymentId = req.params.paymentId;

  if (Array.isArray(paymentId)) {
    throw new AppError("Invalid paymentId", 400);
  }

  const userId = req.user!.userId;
  const role = req.user!.role;

  const result = await paymentService.getPaymentById(paymentId, userId, role);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Payment fetched successfully",
    data: result,
  });
});

const getMyPayments = catchAsync(async (req: Request, res: Response) => {
  const customerId = req.user!.userId;

  const result = await paymentService.getMyPayments(customerId, req.body);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Payments fetched successfully",
    data: result,
  });
});

const refundPayment = catchAsync(async (req: Request, res: Response) => {
  const paymentId = req.params.paymentId;

  if (Array.isArray(paymentId)) {
    throw new AppError("Invalid paymentId", 400);
  }

  const userId = req.user!.userId;
  const result = await paymentService.refundPayment(
    paymentId,
    userId,
    req.body,
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Payment refunded successfully",
    data: result,
  });
});

export const paymentController = {
  createStripeIntent,
  stripeWebhook,
  getPaymentById,
  getMyPayments,
  refundPayment,
};
