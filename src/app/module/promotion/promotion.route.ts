import { Router } from "express";

import { Role } from "../../../../generated/prisma/client.js";

import { auth } from "../../middleware/auth.js";
import { validateRequest } from "../../middleware/validateRequest.js";

import { promotionController } from "./promotion.controller.js";
import { promotionValidation } from "./promotion.validation.js";

const router = Router();

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
