import { Router } from "express";

import { Role } from "../../../../generated/prisma/client.js";

import { auth } from "../../middleware/auth.js";
import { requireFeature } from "../../middleware/requireFeature.js";
import { validateRequest } from "../../middleware/validateRequest.js";

import { packageController } from "./package.controller.js";
import { packageValidation } from "./package.validation.js";

const router = Router();

// =====================================================
// GROUP BUYING FEATURE LICENSE PROTECTION
// =====================================================
//
// Only GROUP_PURCHASE_PACKAGE is supported.
//
// GROUP_BUYING ACTIVE:
//   All package endpoints are available.
//
// GROUP_BUYING DISABLED / EXPIRED:
//   All package endpoints return 403.
//
// Existing database records are preserved.
// =====================================================

router.use(requireFeature("GROUP_BUYING"));

// =====================================================
// CREATE PACKAGE
// =====================================================

router.post(
  "/",
  auth(Role.BRAND_OWNER),
  validateRequest(packageValidation.createPackageValidationSchema),
  packageController.createPackage,
);

// =====================================================
// GET PACKAGES
// =====================================================

router.get(
  "/",
  auth(Role.BRAND_OWNER, Role.CUSTOMER, Role.BRANCH_MANAGER, Role.STAFF),
  packageController.getPackages,
);

// =====================================================
// GET PACKAGE BY ID
// =====================================================

router.get("/:packageId", packageController.getPackageById);

// =====================================================
// UPDATE PACKAGE
// =====================================================

router.patch(
  "/:packageId",
  auth(Role.BRAND_OWNER),
  validateRequest(packageValidation.updatePackageValidationSchema),
  packageController.updatePackage,
);

// =====================================================
// UPDATE PACKAGE STATUS
// =====================================================

router.patch(
  "/:packageId/status",
  auth(Role.BRAND_OWNER),
  validateRequest(packageValidation.updatePackageStatusValidationSchema),
  packageController.updatePackageStatus,
);

// =====================================================
// UPDATE PACKAGE LISTING
// =====================================================

router.patch(
  "/:packageId/listing",
  auth(Role.BRAND_OWNER),
  validateRequest(packageValidation.updatePackageListingValidationSchema),
  packageController.updatePackageListing,
);

// =====================================================
// ASSIGN PACKAGE TO BRANCHES
// =====================================================

router.put(
  "/:packageId/branches",
  auth(Role.BRAND_OWNER),
  validateRequest(packageValidation.assignPackageBranchesValidationSchema),
  packageController.assignPackageToBranches,
);

// =====================================================
// EXPORT ROUTES
// =====================================================

export const PackageRoutes = router;
