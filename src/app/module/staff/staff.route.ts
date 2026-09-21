import { Router } from "express";

import { Role } from "../../../../generated/prisma/client.js";

import { auth } from "../../middleware/auth.js";

import { validateRequest } from "../../middleware/validateRequest.js";

import { staffController } from "./staff.controller.js";

import { staffValidation } from "./staff.validation.js";

const router = Router();

router.post(
  "/",
  auth(Role.BRAND_OWNER, Role.BRANCH_MANAGER),
  validateRequest(staffValidation.createStaffValidationSchema),
  staffController.createStaff,
);

router.get(
  "/",
  auth(Role.BRAND_OWNER, Role.BRANCH_MANAGER),
  staffController.getStaff,
);

router.get(
  "/:staffId",
  auth(Role.BRAND_OWNER, Role.BRANCH_MANAGER),
  staffController.getStaffById,
);

router.patch(
  "/:staffId",
  auth(Role.BRAND_OWNER, Role.BRANCH_MANAGER),
  validateRequest(staffValidation.updateStaffValidationSchema),
  staffController.updateStaff,
);

router.patch(
  "/:staffId/status",
  auth(Role.BRAND_OWNER, Role.BRANCH_MANAGER),
  validateRequest(staffValidation.updateStaffStatusValidationSchema),
  staffController.updateStaffStatus,
);

router.put(
  "/:staffId/branches",
  auth(Role.BRAND_OWNER, Role.BRANCH_MANAGER),
  validateRequest(staffValidation.assignStaffBranchesValidationSchema),
  staffController.assignStaffBranches,
);

router.put(
  "/:staffId/services",
  auth(Role.BRAND_OWNER, Role.BRANCH_MANAGER),
  validateRequest(staffValidation.assignStaffServicesValidationSchema),
  staffController.assignStaffServices,
);

router.put(
  "/:staffId/packages",
  auth(Role.BRAND_OWNER, Role.BRANCH_MANAGER),
  validateRequest(staffValidation.assignStaffPackagesValidationSchema),
  staffController.assignStaffPackages,
);

export const StaffRoutes = router;
