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
// BRAND INTERNATIONAL SETTINGS
// =====================================================

// BRAND_OWNER - Get international settings
router.get(
  "/international-settings",
  auth(Role.BRAND_OWNER),
  brandController.getBrandInternationalSettings,
);

// BRAND_OWNER - Update international settings
router.patch(
  "/international-settings",
  auth(Role.BRAND_OWNER),
  validateRequest(
    brandValidation.updateBrandInternationalSettingsValidationSchema,
  ),
  brandController.updateBrandInternationalSettings,
);

// =====================================================
// EXISTING BRAND APIs
// =====================================================

// Public - Get brand information
router.get("/", brandController.getBrand);

// BRAND_OWNER - Update brand information
router.patch(
  "/",
  auth(Role.BRAND_OWNER),
  validateRequest(brandValidation.updateBrandValidationSchema),
  brandController.updateBrand,
);

export const BrandRoutes = router;
