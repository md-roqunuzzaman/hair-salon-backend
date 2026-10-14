import { Router } from "express";

import { Role } from "../../../../generated/prisma/client.js";

import { RefundRequestController } from "./refund-request.controller.js";

import {
  createRefundRequestValidationSchema,
  processRefundRequestValidationSchema,
  reviewRefundRequestValidationSchema,
} from "./refund-request.validation.js";
import { auth } from "../../middleware/auth.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import z from "zod";
import { AppError } from "../../utils/app-error.js";

const router = Router();

// =====================================================
// CUSTOMER — CREATE REFUND REQUEST
// =====================================================

router.post(
  "/",
  auth(Role.CUSTOMER),
  validateRequest(createRefundRequestValidationSchema),
  RefundRequestController.createRefundRequest,
);

router.get(
  "/my",
  auth(Role.CUSTOMER),
  RefundRequestController.getMyRefundRequests,
);
router.get(
  "/",
  auth(Role.BRAND_OWNER),
  RefundRequestController.getRefundRequests,
);

router.patch(
  "/:id/review",
  auth(Role.BRAND_OWNER),
  validateRequest(reviewRefundRequestValidationSchema),
  RefundRequestController.reviewRefundRequest,
);

router.post(
  "/:id/process",
  auth(Role.BRAND_OWNER),
  validateRequest(processRefundRequestValidationSchema),
  RefundRequestController.processApprovedRefund,
);

router.get(
  "/:id",
  auth(Role.CUSTOMER, Role.BRAND_OWNER, Role.BRANCH_MANAGER),
  RefundRequestController.getRefundRequestById,
);
export const RefundRequestRoutes = router;
