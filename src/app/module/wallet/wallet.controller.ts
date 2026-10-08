import { Request, Response } from "express";
import httpStatus from "http-status";

import { catchAsync } from "../../utils/catchAsync.js";
import { sendResponse } from "../../utils/sendResponse.js";

import { walletService } from "./wallet.service.js";
import { AppError } from "../../utils/app-error.js";

const getMyWallet = catchAsync(async (req: Request, res: Response) => {
  const customerId = req.user!.userId;

  const result = await walletService.getMyWallet(customerId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Wallet fetched successfully",
    data: result,
  });
});

const getMyTransactions = catchAsync(async (req: Request, res: Response) => {
  const customerId = req.user!.userId;

  const result = await walletService.getMyTransactions(customerId, req.body);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Wallet transactions fetched successfully",
    data: result,
  });
});

const createTopup = catchAsync(async (req: Request, res: Response) => {
  const customerId = req.user!.userId;

  const result = await walletService.createTopup(customerId, req.body);

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Wallet top-up initiated successfully",
    data: result,
  });
});

const payAppointmentWithWallet = catchAsync(
  async (req: Request, res: Response) => {
    const customerId = req.user!.userId;

    const appointmentId = req.params.appointmentId;

    if (!appointmentId || Array.isArray(appointmentId)) {
      throw new AppError("Invalid appointmentId", 400);
    }

    const result = await walletService.payAppointmentWithWallet(
      customerId,
      appointmentId,
      req.body,
    );

    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Appointment paid with wallet successfully",
      data: result,
    });
  },
);

const payGroupPurchaseWithWallet = catchAsync(
  async (req: Request, res: Response) => {
    const customerId = req.user!.userId;

    const purchaseId = req.params.purchaseId;

    if (typeof purchaseId !== "string" || !purchaseId.trim()) {
      throw new AppError("INVALID_GROUP_PURCHASE_ID", 400);
    }

    const result = await walletService.payGroupPurchaseWithWallet(
      customerId,
      purchaseId,
      req.body,
    );

    sendResponse(res, {
      statusCode: 200,
      success: true,
      message: "Group purchase paid with wallet successfully",
      data: result,
    });
  },
);

export const walletController = {
  getMyWallet,
  getMyTransactions,
  createTopup,
  payAppointmentWithWallet,
  payGroupPurchaseWithWallet,
};
