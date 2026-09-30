import { Router } from "express";

import { Role } from "../../../../generated/prisma/client.js";

import { auth } from "../../middleware/auth.js";
import { validateRequest } from "../../middleware/validateRequest.js";

import { branchManagerController } from "./branch-manager.controller.js";
import { branchManagerValidation } from "./branch-manager.validation.js";

const router = Router();

router.post(
  "/",

  auth(Role.BRAND_OWNER),

  validateRequest(branchManagerValidation.createBranchManagerValidationSchema),

  branchManagerController.createBranchManager,
);

router.get(
  "/",
  auth(Role.BRAND_OWNER),
  branchManagerController.getBranchManagers,
);

router.get(
  "/:managerId",
  auth(Role.BRAND_OWNER),
  branchManagerController.getBranchManagerById,
);

router.put(
  "/:managerId/branches",
  auth(Role.BRAND_OWNER),
  validateRequest(
    branchManagerValidation.updateBranchManagerBranchesValidationSchema,
  ),
  branchManagerController.updateBranchManagerBranches,
);

router.patch(
  "/:managerId/status",
  auth(Role.BRAND_OWNER),
  validateRequest(
    branchManagerValidation.updateBranchManagerStatusValidationSchema,
  ),
  branchManagerController.updateBranchManagerStatus,
);

export const BranchManagerRoutes = router;
