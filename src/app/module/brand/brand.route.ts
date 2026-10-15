import { Router } from "express";

import { Role } from "../../../../generated/prisma/client.js";

import { auth } from "../../middleware/auth.js";
import { validateRequest } from "../../middleware/validateRequest.js";

import { brandController } from "./brand.controller.js";
import { brandValidation } from "./brand.validation.js";

const router = Router();

// =====================================================
// BRAND THEME
// =====================================================

// Public - Customer App
router.get("/theme", brandController.getBrandTheme);

// BRAND_OWNER - Admin Dashboard
router.patch(
  "/theme",
  auth(Role.BRAND_OWNER),
  validateRequest(brandValidation.updateBrandThemeValidationSchema),
  brandController.updateBrandTheme,
);

// =====================================================
// EXISTING BRAND APIs
// =====================================================

router.get("/", brandController.getBrand);

router.patch(
  "/",
  auth(Role.BRAND_OWNER),
  validateRequest(brandValidation.updateBrandValidationSchema),
  brandController.updateBrand,
);

export const BrandRoutes = router;
