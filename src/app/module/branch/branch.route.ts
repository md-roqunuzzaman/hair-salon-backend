import { Router } from "express";

import { Role } from "../../../../generated/prisma/client.js";

import { auth } from "../../middleware/auth.js";
import { validateRequest } from "../../middleware/validateRequest.js";

import { branchController } from "./branch.controller.js";
import { branchValidation } from "./branch.validation.js";
import { packageController } from "../package/package.controller.js";
import { staffController } from "../staff/staff.controller.js";

const router = Router();

router.post(
  "/",
  auth(Role.BRAND_OWNER),
  validateRequest(branchValidation.createBranchValidationSchema),
  branchController.createBranch,
);

router.get("/", branchController.getBranches);

router.get("/:branchId", branchController.getBranchById);

router.patch(
  "/:branchId",
  auth(Role.BRAND_OWNER),
  validateRequest(branchValidation.updateBranchValidationSchema),
  branchController.updateBranch,
);

router.patch(
  "/:branchId/status",
  auth(Role.BRAND_OWNER),
  validateRequest(branchValidation.updateBranchStatusValidationSchema),
  branchController.updateBranchStatus,
);

router.get("/:branchId/business-hours", branchController.getBusinessHours);

router.put(
  "/:branchId/business-hours",
  auth(Role.BRAND_OWNER, Role.BRANCH_MANAGER),
  validateRequest(branchValidation.updateBusinessHoursValidationSchema),
  branchController.updateBusinessHours,
);

router.get("/:branchId/booking-policy", branchController.getBookingPolicy);

router.put(
  "/:branchId/booking-policy",
  auth(Role.BRAND_OWNER, Role.BRANCH_MANAGER),
  validateRequest(branchValidation.updateBookingPolicyValidationSchema),
  branchController.updateBookingPolicy,
);

router.get("/:branchId/packages", packageController.getBranchPackages);

router.get("/:branchId/staff", staffController.getBranchStaff);

router.get(
  "/:branchId/services/:serviceId/staff",
  staffController.getEligibleStaffForService,
);

router.get(
  "/:branchId/packages/:packageId/staff",
  staffController.getEligibleStaffForPackage,
);

export const BranchRoutes = router;
