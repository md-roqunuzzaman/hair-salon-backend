import { Router } from "express";

import { Role } from "../../../../generated/prisma/client.js";

import {
  getPricing,
  updatePlanPricing,
  updateAddonPricing,
} from "./platform.pricing.controller.js";
import { auth } from "../../middleware/auth.js";

const router = Router();

// =====================================================
// SUPER ADMIN ONLY
// =====================================================

router.use(auth(Role.SUPER_ADMIN));

// =====================================================
// GET ALL PRICING
// =====================================================

router.get("/", getPricing);

// =====================================================
// UPDATE STANDARD PLAN PRICE
// =====================================================

router.patch("/plan", updatePlanPricing);

// =====================================================
// UPDATE PREMIUM ADD-ON PRICE
// =====================================================

router.patch("/addons/:code", updateAddonPricing);

export const platformPricingRoutes = router;
