import express from "express";

import { Role } from "../../../../generated/prisma/client.js";

import { auth } from "../../middleware/auth.js";
import { validateRequest } from "../../middleware/validateRequest.js";

import { branchHourlyCapacityController } from "./branch-hourly-capacity.controller.js";
import { branchHourlyCapacityValidation } from "./branch-hourly-capacity.validation.js";

const router = express.Router();

router.get(
  "/:branchId/hourly-capacity",

  auth(Role.BRAND_OWNER, Role.BRANCH_MANAGER),

  branchHourlyCapacityController.getBranchHourlyCapacity,
);

router.put(
  "/:branchId/hourly-capacity",

  auth(Role.BRAND_OWNER, Role.BRANCH_MANAGER),

  validateRequest(
    branchHourlyCapacityValidation.updateBranchHourlyCapacitySchema,
  ),

  branchHourlyCapacityController.updateBranchHourlyCapacity,
);

export const BranchHourlyCapacityRoutes = router;
