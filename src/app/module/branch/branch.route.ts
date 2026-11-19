import { NextFunction, Request, Response, Router } from "express";

import { Role } from "../../../../generated/prisma/client.js";

import { auth } from "../../middleware/auth.js";
import { requireFeature } from "../../middleware/requireFeature.js";
import { validateRequest } from "../../middleware/validateRequest.js";

import { branchGroupPurchasePolicyController } from "./branch-group-purchase-policy.controller.js";
import { branchGroupPurchasePolicyValidation } from "./branch-group-purchase-policy.validation.js";

import { branchController } from "./branch.controller.js";
import { branchValidation } from "./branch.validation.js";

import { packageController } from "../package/package.controller.js";
import { staffController } from "../staff/staff.controller.js";

import { appointmentValidation } from "../appointment/appointment.validation.js";
import { appointmentController } from "../appointment/appointment.controller.js";

import { reviewValidation } from "../review/review.validation.js";
import { reviewController } from "../review/review.controller.js";

import { dashboardValidation } from "../dashboard/dashboard.validation.js";
import { dashboardController } from "../dashboard/dashboard.controller.js";

const router = Router();

// =====================================================
// BRANCH STORE LICENSE POLICY
// =====================================================
//
// BRANCH_STORE ACTIVE:
//   Multi-branch mode.
//   Maximum branches = configured branchLimit.
//
// BRANCH_STORE DISABLED / EXPIRED:
//   Single-branch mode.
//   Maximum branches = 1.
//
// IMPORTANT:
//   Do not apply requireFeature("BRANCH_STORE")
//   globally to this router.
//
//   Branch creation limits are enforced inside
//   branch-limit.service.ts.
//
//   Normal branch operations remain available.
//
// =====================================================

// =====================================================
// QUERY HELPERS
// =====================================================

const queryToBody = (req: Request, res: Response, next: NextFunction) => {
  req.body = { ...req.query };
  next();
};

const nearbyQueryToBody = (req: Request, res: Response, next: NextFunction) => {
  req.body = { ...req.query };
  next();
};

const appointmentQueryToBody = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  req.body = req.query;
  next();
};

const dailySummaryQueryToBody = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  req.body = {
    date: req.query.date,
  };
  next();
};

const dailySeriesQueryToBody = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  req.body = {
    start: req.query.start,
    end: req.query.end,
  };
  next();
};

const staffOutputQueryToBody = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  req.body = {
    start: req.query.start,
    end: req.query.end,
  };
  next();
};

// =====================================================
// CREATE BRANCH
// =====================================================
//
// BRANCH_STORE ACTIVE:
//   Enforce configured branchLimit.
//
// BRANCH_STORE DISABLED / EXPIRED:
//   Maximum 1 branch.
//
// Limit validation occurs in createBranch service.
// =====================================================

router.post(
  "/",
  auth(Role.BRAND_OWNER),
  validateRequest(branchValidation.createBranchValidationSchema),
  branchController.createBranch,
);

// =====================================================
// GET BRANCHES
// =====================================================

router.get("/", branchController.getBranches);

// =====================================================
// NEARBY BRANCHES
// =====================================================

router.get(
  "/nearby",
  nearbyQueryToBody,
  validateRequest(branchValidation.getNearbyBranchesValidationSchema),
  branchController.getNearbyBranches,
);

// =====================================================
// GET BRANCH BY ID
// =====================================================

router.get("/:branchId", branchController.getBranchById);

// =====================================================
// UPDATE BRANCH
// =====================================================

router.patch(
  "/:branchId",
  auth(Role.BRAND_OWNER),
  validateRequest(branchValidation.updateBranchValidationSchema),
  branchController.updateBranch,
);

// =====================================================
// UPDATE BRANCH STATUS
// =====================================================

router.patch(
  "/:branchId/status",
  auth(Role.BRAND_OWNER),
  validateRequest(branchValidation.updateBranchStatusValidationSchema),
  branchController.updateBranchStatus,
);

// =====================================================
// BUSINESS HOURS
// =====================================================

router.get("/:branchId/business-hours", branchController.getBusinessHours);

router.put(
  "/:branchId/business-hours",
  auth(Role.BRAND_OWNER, Role.BRANCH_MANAGER),
  validateRequest(branchValidation.updateBusinessHoursValidationSchema),
  branchController.updateBusinessHours,
);

// =====================================================
// BOOKING POLICY
// =====================================================

router.get("/:branchId/booking-policy", branchController.getBookingPolicy);

router.put(
  "/:branchId/booking-policy",
  auth(Role.BRAND_OWNER),
  validateRequest(branchValidation.updateBookingPolicyValidationSchema),
  branchController.updateBookingPolicy,
);

// =====================================================
// CANCELLATION POLICY
// =====================================================

router.put(
  "/:branchId/cancellation-policy",
  auth(Role.BRAND_OWNER, Role.BRANCH_MANAGER),
  validateRequest(branchValidation.updateCancellationPolicyValidationSchema),
  branchController.updateCancellationPolicy,
);

router.get(
  "/:branchId/cancellation-policy",
  branchController.getCancellationPolicy,
);

// =====================================================
// BRANCH PACKAGES
// =====================================================

router.get("/:branchId/packages", requireFeature("GROUP_BUYING"), packageController.getBranchPackages);

// =====================================================
// BRANCH STAFF
// =====================================================
//
// Requires HAIRSTYLIST feature.
// =====================================================

router.get(
  "/:branchId/staff",
  requireFeature("HAIRSTYLIST"),
  staffController.getBranchStaff,
);

// =====================================================
// SERVICE ELIGIBLE STAFF
// =====================================================
//
// Requires HAIRSTYLIST feature.
// =====================================================

router.get(
  "/:branchId/services/:serviceId/staff",
  requireFeature("HAIRSTYLIST"),
  staffController.getEligibleStaffForService,
);

// =====================================================
// PACKAGE ELIGIBLE STAFF
// =====================================================
//
// Requires HAIRSTYLIST feature.
// =====================================================

router.get(
  "/:branchId/packages/:packageId/staff",
  requireFeature("HAIRSTYLIST"),
  staffController.getEligibleStaffForPackage,
);

// =====================================================
// BRANCH APPOINTMENTS
// =====================================================

router.get(
  "/:branchId/appointments",
  auth(Role.STAFF, Role.BRANCH_MANAGER, Role.BRAND_OWNER),
  appointmentQueryToBody,
  validateRequest(appointmentValidation.getBranchAppointmentsValidationSchema),
  appointmentController.getBranchAppointments,
);

// =====================================================
// BRANCH REVIEWS
// =====================================================
//
// Requires REVIEWS feature.
// =====================================================

router.get(
  "/:branchId/reviews",
  requireFeature("REVIEWS"),
  queryToBody,
  validateRequest(reviewValidation.getReviewsValidationSchema),
  reviewController.getBranchReviews,
);

// =====================================================
// BRANCH DASHBOARD
// =====================================================

router.get(
  "/:branchId/dashboard",
  auth(Role.BRAND_OWNER, Role.BRANCH_MANAGER),
  queryToBody,
  validateRequest(dashboardValidation.getDashboardValidationSchema),
  dashboardController.getBranchDashboard,
);

// =====================================================
// BRANCH CUSTOMER SEARCH
// =====================================================

router.get(
  "/:branchId/customers/search",
  auth(Role.BRAND_OWNER, Role.BRANCH_MANAGER),
  queryToBody,
  validateRequest(branchValidation.customerOperationalSearchValidationSchema),
  branchController.searchBranchCustomers,
);

// =====================================================
// DAILY SUMMARY
// =====================================================

router.get(
  "/:branchId/reports/daily-summary",
  auth(Role.BRAND_OWNER, Role.BRANCH_MANAGER),
  dailySummaryQueryToBody,
  validateRequest(branchValidation.getBranchDailySummaryValidationSchema),
  branchController.getBranchDailySummary,
);

// =====================================================
// DAILY SERIES
// =====================================================

router.get(
  "/:branchId/reports/daily-series",
  auth(Role.BRAND_OWNER, Role.BRANCH_MANAGER),
  dailySeriesQueryToBody,
  validateRequest(branchValidation.getBranchDailySeriesValidationSchema),
  branchController.getBranchDailySeries,
);

// =====================================================
// STAFF OUTPUT REPORT
// =====================================================

router.get(
  "/:branchId/reports/staff-output",
  auth(Role.BRAND_OWNER, Role.BRANCH_MANAGER),
  staffOutputQueryToBody,
  validateRequest(branchValidation.getBranchStaffOutputValidationSchema),
  branchController.getBranchStaffOutput,
);

// =====================================================
// GROUP PURCHASE REFUND POLICY
// =====================================================
//
// Requires GROUP_BUYING feature.
// =====================================================

router.get(
  "/:branchId/group-purchase-refund-policy",
  auth(Role.BRAND_OWNER, Role.BRANCH_MANAGER),
  branchGroupPurchasePolicyController.getGroupPurchaseRefundPolicy,
);

router.put(
  "/:branchId/group-purchase-refund-policy",
  auth(Role.BRAND_OWNER, Role.BRANCH_MANAGER),
  requireFeature("GROUP_BUYING"),
  validateRequest(
    branchGroupPurchasePolicyValidation.updateGroupPurchaseRefundPolicyValidationSchema,
  ),
  branchGroupPurchasePolicyController.updateGroupPurchaseRefundPolicy,
);

// =====================================================
// GROUP PURCHASE CANCELLATION POLICY
// =====================================================
//
// Requires GROUP_BUYING feature.
// =====================================================

router.get(
  "/:branchId/group-purchase-cancellation-policy",
  auth(Role.BRAND_OWNER, Role.BRANCH_MANAGER),
  branchGroupPurchasePolicyController.getGroupPurchaseCancellationPolicy,
);

router.put(
  "/:branchId/group-purchase-cancellation-policy",
  auth(Role.BRAND_OWNER, Role.BRANCH_MANAGER),
  requireFeature("GROUP_BUYING"),
  validateRequest(
    branchGroupPurchasePolicyValidation.updateGroupPurchaseCancellationPolicyValidationSchema,
  ),
  branchGroupPurchasePolicyController.updateGroupPurchaseCancellationPolicy,
);

// =====================================================
// EXPORT ROUTER
// =====================================================

export const BranchRoutes = router;
