import { Request, Response } from 'express';
import httpStatus from 'http-status';
import { catchAsync } from '../../utils/catchAsync.js';
import { sendResponse } from '../../utils/sendResponse.js';
import { branchGroupPurchasePolicyService } from './branch-group-purchase-policy.service.js';
const updateGroupPurchaseRefundPolicy = catchAsync(
  async (req: Request, res: Response) => {
    const { branchId } = req.params;

    const userId = req.user!.userId;
    const role = req.user!.role;

    const result = await branchGroupPurchasePolicyService.updateGroupPurchaseRefundPolicy(
      branchId as string,
      req.body,
      userId,
      role,
    );

    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Group purchase refund policy updated successfully",
      data: result,
    });
  },
);

// =====================================================
// GET GROUP PURCHASE REFUND POLICY
// =====================================================

const getGroupPurchaseRefundPolicy = catchAsync(
  async (req: Request, res: Response) => {
    const { branchId } = req.params;

    const result = await branchGroupPurchasePolicyService.getGroupPurchaseRefundPolicy(
      branchId as string, req.user!.userId, req.user!.role,
    );

    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Group purchase refund policy retrieved successfully",
      data: result,
    });
  },
);

// =====================================================
// UPDATE GROUP PURCHASE CANCELLATION POLICY
// =====================================================

const updateGroupPurchaseCancellationPolicy = catchAsync(
  async (req: Request, res: Response) => {
    const { branchId } = req.params;

    const result = await branchGroupPurchasePolicyService.updateGroupPurchaseCancellationPolicy(
      branchId as string,
      req.body,
      req.user!.userId,
      req.user!.role,
    );

    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Group purchase cancellation policy updated successfully",
      data: result,
    });
  },
);

// =====================================================
// GET GROUP PURCHASE CANCELLATION POLICY
// =====================================================

const getGroupPurchaseCancellationPolicy = catchAsync(
  async (req: Request, res: Response) => {
    const { branchId } = req.params;

    const result = await branchGroupPurchasePolicyService.getGroupPurchaseCancellationPolicy(
      branchId as string, req.user!.userId, req.user!.role,
    );

    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Group purchase cancellation policy retrieved successfully",
      data: result,
    });
  },
);
// =====================================================
// EXPORT CONTROLLER
// =====================================================


export const branchGroupPurchasePolicyController = { updateGroupPurchaseRefundPolicy, getGroupPurchaseRefundPolicy, updateGroupPurchaseCancellationPolicy, getGroupPurchaseCancellationPolicy };
