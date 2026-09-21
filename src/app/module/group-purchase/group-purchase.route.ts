import { Router } from "express";

import { Role } from "../../../../generated/prisma/client.js";

import { auth } from "../../middleware/auth.js";

import { validateRequest } from "../../middleware/validateRequest.js";

import { groupPurchaseController } from "./group-purchase.controller.js";

import { groupPurchaseValidation } from "./group-purchase.validation.js";

const router = Router();

router.post(
  "/",
  auth(Role.CUSTOMER),
  validateRequest(groupPurchaseValidation.createGroupPurchaseValidationSchema),
  groupPurchaseController.createGroupPurchase,
);

router.get(
  "/my",
  auth(Role.CUSTOMER),
  groupPurchaseController.getMyGroupPurchases,
);

router.get(
  "/:purchaseId",
  auth(Role.CUSTOMER, Role.BRANCH_MANAGER, Role.BRAND_OWNER),
  groupPurchaseController.getGroupPurchaseById,
);
export const GroupPurchaseRoutes = router;
