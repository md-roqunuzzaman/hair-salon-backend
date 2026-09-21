import { Router } from "express";

import { Role } from "../../../../generated/prisma/client.js";

import { auth } from "../../middleware/auth.js";

import { validateRequest } from "../../middleware/validateRequest.js";

import { packageController } from "./package.controller.js";

import { packageValidation } from "./package.validation.js";

const router = Router();

router.post(
  "/",
  auth(Role.BRAND_OWNER),
  validateRequest(packageValidation.createPackageValidationSchema),
  packageController.createPackage,
);

router.get("/", auth(Role.BRAND_OWNER), packageController.getPackages);

router.get("/:packageId", packageController.getPackageById);

router.patch(
  "/:packageId",
  auth(Role.BRAND_OWNER),
  validateRequest(packageValidation.updatePackageValidationSchema),
  packageController.updatePackage,
);

router.patch(
  "/:packageId/status",
  auth(Role.BRAND_OWNER),
  validateRequest(packageValidation.updatePackageStatusValidationSchema),
  packageController.updatePackageStatus,
);

router.patch(
  "/:packageId/listing",
  auth(Role.BRAND_OWNER),
  validateRequest(packageValidation.updatePackageListingValidationSchema),
  packageController.updatePackageListing,
);

router.put(
  "/:packageId/branches",
  auth(Role.BRAND_OWNER),
  validateRequest(packageValidation.assignPackageBranchesValidationSchema),
  packageController.assignPackageToBranches,
);

export const PackageRoutes = router;
