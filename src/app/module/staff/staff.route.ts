import { NextFunction, Request, Response, Router } from "express";

import { Role } from "../../../../generated/prisma/client.js";

import { auth } from "../../middleware/auth.js";
import { requireFeature } from "../../middleware/requireFeature.js";
import { validateRequest } from "../../middleware/validateRequest.js";

import { staffController } from "./staff.controller.js";
import { staffValidation } from "./staff.validation.js";

import { reviewValidation } from "../review/review.validation.js";
import { reviewController } from "../review/review.controller.js";

const router = Router();

const queryToBody = (req: Request, res: Response, next: NextFunction) => {
  req.body = req.query;
  next();
};

// =====================================================
// HAIRSTYLIST FEATURE LICENSE PROTECTION
// =====================================================
// Disabled or expired = ALL Staff endpoints return 403
// =====================================================

router.use(requireFeature("HAIRSTYLIST"));

// =====================================================
// CREATE STAFF
// =====================================================

router.post(
  "/",
  auth(Role.BRAND_OWNER, Role.BRANCH_MANAGER),
  validateRequest(staffValidation.createStaffValidationSchema),
  staffController.createStaff,
);

// =====================================================
// GET STAFF LIST
// =====================================================

router.get(
  "/",
  auth(Role.BRAND_OWNER, Role.BRANCH_MANAGER),
  staffController.getStaff,
);

// =====================================================
// GET STAFF BY ID
// =====================================================

router.get(
  "/:staffId",
  auth(Role.BRAND_OWNER, Role.BRANCH_MANAGER, Role.STAFF, Role.CUSTOMER),
  staffController.getStaffById,
);

// =====================================================
// UPDATE STAFF
// =====================================================

router.patch(
  "/:staffId",
  auth(Role.BRAND_OWNER, Role.BRANCH_MANAGER),
  validateRequest(staffValidation.updateStaffValidationSchema),
  staffController.updateStaff,
);

// =====================================================
// UPDATE STAFF STATUS
// =====================================================

router.patch(
  "/:staffId/status",
  auth(Role.BRAND_OWNER, Role.BRANCH_MANAGER),
  validateRequest(staffValidation.updateStaffStatusValidationSchema),
  staffController.updateStaffStatus,
);

// =====================================================
// ASSIGN STAFF BRANCHES
// =====================================================

router.put(
  "/:staffId/branches",
  auth(Role.BRAND_OWNER, Role.BRANCH_MANAGER),
  validateRequest(staffValidation.assignStaffBranchesValidationSchema),
  staffController.assignStaffBranches,
);

// =====================================================
// ASSIGN STAFF SERVICES
// =====================================================

router.put(
  "/:staffId/services",
  auth(Role.BRAND_OWNER, Role.BRANCH_MANAGER),
  validateRequest(staffValidation.assignStaffServicesValidationSchema),
  staffController.assignStaffServices,
);

// =====================================================
// ASSIGN STAFF PACKAGES
// =====================================================

router.put(
  "/:staffId/packages",
  auth(Role.BRAND_OWNER, Role.BRANCH_MANAGER),
  validateRequest(staffValidation.assignStaffPackagesValidationSchema),
  staffController.assignStaffPackages,
);

// =====================================================
// UPDATE STAFF SCHEDULE
// =====================================================

router.put(
  "/:staffId/schedule",
  auth(Role.BRAND_OWNER, Role.BRANCH_MANAGER),
  validateRequest(staffValidation.updateStaffScheduleValidationSchema),
  staffController.updateStaffSchedule,
);

// =====================================================
// MY APPOINTMENTS
// =====================================================

router.get(
  "/me/appointments",
  auth(Role.STAFF),
  queryToBody,
  validateRequest(staffValidation.getMyAppointmentsValidationSchema),
  staffController.getMyAppointments,
);

// =====================================================
// MY SCHEDULE
// =====================================================

router.get(
  "/me/schedule",
  auth(Role.STAFF),
  staffController.getMyStaffSchedule,
);

// =====================================================
// MY REVIEWS
// Requires BOTH HAIRSTYLIST and REVIEWS
// =====================================================

router.get(
  "/me/reviews",
  auth(Role.STAFF),
  requireFeature("REVIEWS"),
  reviewController.getMyStaffReview,
);

// =====================================================
// GET STAFF SCHEDULE
// =====================================================

router.get(
  "/:staffId/schedule",
  auth(Role.BRAND_OWNER, Role.BRANCH_MANAGER, Role.STAFF),
  staffController.getStaffSchedule,
);

// =====================================================
// CREATE STAFF UNAVAILABILITY
// =====================================================

router.post(
  "/:staffId/unavailability",
  auth(Role.BRAND_OWNER, Role.BRANCH_MANAGER),
  validateRequest(staffValidation.createStaffUnavailabilityValidationSchema),
  staffController.createStaffUnavailability,
);

// =====================================================
// GET STAFF UNAVAILABILITY
// =====================================================

router.get(
  "/:staffId/unavailability",
  auth(Role.BRAND_OWNER, Role.BRANCH_MANAGER, Role.STAFF),
  staffController.getStaffUnavailability,
);

// =====================================================
// UPDATE STAFF UNAVAILABILITY
// =====================================================

router.patch(
  "/:staffId/unavailability/:id",
  auth(Role.BRAND_OWNER, Role.BRANCH_MANAGER),
  validateRequest(staffValidation.updateStaffUnavailabilityValidationSchema),
  staffController.updateStaffUnavailability,
);

// =====================================================
// DELETE STAFF UNAVAILABILITY
// =====================================================

router.delete(
  "/:staffId/unavailability/:id",
  auth(Role.BRAND_OWNER, Role.BRANCH_MANAGER),
  staffController.deleteStaffUnavailability,
);

// =====================================================
// GET STAFF REVIEWS
// Requires BOTH HAIRSTYLIST and REVIEWS
// =====================================================

router.get(
  "/:staffId/reviews",
  requireFeature("REVIEWS"),
  queryToBody,
  validateRequest(reviewValidation.getReviewsValidationSchema),
  reviewController.getStaffReviews,
);

// =====================================================
// CREATE STAFF SCHEDULE OVERRIDE
// =====================================================

router.post(
  "/:staffId/schedule-overrides",
  auth(Role.BRAND_OWNER),
  validateRequest(staffValidation.createStaffScheduleOverrideValidationSchema),
  staffController.createStaffScheduleOverride,
);

// =====================================================
// GET STAFF SCHEDULE OVERRIDES
// =====================================================

router.get(
  "/:staffId/schedule-overrides",
  auth(Role.BRAND_OWNER, Role.BRANCH_MANAGER, Role.STAFF),
  validateRequest(staffValidation.getStaffScheduleOverridesValidationSchema),
  staffController.getStaffScheduleOverrides,
);

// =====================================================
// UPDATE STAFF SCHEDULE OVERRIDE
// =====================================================

router.patch(
  "/:staffId/schedule-overrides/:overrideId",
  auth(Role.BRAND_OWNER),
  validateRequest(staffValidation.updateStaffScheduleOverrideValidationSchema),
  staffController.updateStaffScheduleOverride,
);

// =====================================================
// DELETE STAFF SCHEDULE OVERRIDE
// =====================================================

router.delete(
  "/:staffId/schedule-overrides/:overrideId",
  auth(Role.BRAND_OWNER),
  staffController.deleteStaffScheduleOverride,
);

// =====================================================
// UPDATE SINGLE STAFF WEEKLY SCHEDULE
// =====================================================

router.patch(
  "/:staffId/schedules/:scheduleId",
  auth(Role.BRAND_OWNER),
  validateRequest(staffValidation.updateSingleStaffScheduleValidation),
  staffController.updateSingleStaffSchedule,
);

// =====================================================
// DELETE SINGLE STAFF WEEKLY SCHEDULE
// =====================================================

router.delete(
  "/:staffId/schedules/:scheduleId",
  auth(Role.BRAND_OWNER),
  staffController.deleteSingleStaffSchedule,
);

export const StaffRoutes = router;
