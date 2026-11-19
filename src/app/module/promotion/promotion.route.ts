import { Router } from "express";

import { Role } from "../../../../generated/prisma/client.js";

import { auth } from "../../middleware/auth.js";
import { requireFeature } from "../../middleware/requireFeature.js";
import { validateRequest } from "../../middleware/validateRequest.js";

import { promotionController } from "./promotion.controller.js";
import { promotionValidation } from "./promotion.validation.js";

const router = Router();

// =====================================================
// WALLET FEATURE LICENSE
// =====================================================
// Promotion module manages wallet top-up bonuses.
//
// WALLET enabled:
//   Existing promotion operations work normally.
//
// WALLET disabled / expired:
//   All promotion endpoints return 403.
// =====================================================

router.use(requireFeature("WALLET"));

router.post(
  "/",
  auth(Role.BRAND_OWNER),
  validateRequest(promotionValidation.createPromotionValidationSchema),
  promotionController.createPromotion,
);

router.get(
  "/",
  auth(Role.CUSTOMER, Role.BRAND_OWNER),
  promotionController.getPromotions,
);

router.get(
  "/:promotionId",
  auth(Role.CUSTOMER, Role.BRAND_OWNER),
  promotionController.getPromotionById,
);

router.patch(
  "/:promotionId",
  auth(Role.BRAND_OWNER),
  validateRequest(promotionValidation.updatePromotionValidationSchema),
  promotionController.updatePromotion,
);

router.patch(
  "/:promotionId/status",
  auth(Role.BRAND_OWNER),
  validateRequest(promotionValidation.updatePromotionStatusValidationSchema),
  promotionController.updatePromotionStatus,
);

export const PromotionRoutes = router;
