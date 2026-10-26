import { Router } from "express";

import { Role } from "../../../../generated/prisma/client.js";

import { bannerController } from "./banner.controller.js";
import { bannerValidation } from "./banner.validation.js";
import { auth } from "../../middleware/auth.js";
import { validateRequest } from "../../middleware/validateRequest.js";

// =====================================================
// ROUTER
// =====================================================

const router = Router();

// =====================================================
// API 01 — CREATE BANNER
// POST /api/v1/banners
// =====================================================

router.post(
  "/",
  auth(Role.BRAND_OWNER, Role.BRANCH_MANAGER),
  validateRequest(bannerValidation.createBannerValidationSchema),
  bannerController.createBanner,
);

// =====================================================
// API 09 — CUSTOMER ACTIVE BANNERS
// =====================================================

router.get(
  "/active",
  validateRequest(bannerValidation.getActiveBannersValidationSchema),
  bannerController.getActiveBanners,
);
// =====================================================
// EXPORT
// =====================================================

// =====================================================
// API 02 — ATTACH BANNER MEDIA
// POST /api/v1/banners/:bannerId/media
// =====================================================

router.post(
  "/:bannerId/media",
  auth(Role.BRAND_OWNER, Role.BRANCH_MANAGER),
  validateRequest(bannerValidation.attachBannerMediaValidationSchema),
  bannerController.attachBannerMedia,
);
router.get(
  "/admin",
  auth(Role.BRAND_OWNER, Role.BRANCH_MANAGER),
  validateRequest(bannerValidation.getAdminBannersValidationSchema),
  bannerController.getAdminBanners,
);
router.patch(
  "/:bannerId/status",
  auth(Role.BRAND_OWNER, Role.BRANCH_MANAGER),
  validateRequest(bannerValidation.updateBannerStatusValidationSchema),
  bannerController.updateBannerStatus,
);

router.get(
  "/:bannerId",
  auth(Role.BRAND_OWNER, Role.BRANCH_MANAGER),
  validateRequest(bannerValidation.getBannerDetailsValidationSchema),
  bannerController.getBannerDetails,
);

router.patch(
  "/:bannerId",
  auth(Role.BRAND_OWNER, Role.BRANCH_MANAGER),
  validateRequest(bannerValidation.updateBannerValidationSchema),
  bannerController.updateBanner,
);

// =====================================================
// API 07 — REMOVE BANNER MEDIA
// =====================================================

router.delete(
  "/:bannerId/media/:mediaId",
  auth(Role.BRAND_OWNER, Role.BRANCH_MANAGER),
  validateRequest(bannerValidation.removeBannerMediaValidationSchema),
  bannerController.removeBannerMedia,
);

// =====================================================
// API 08 — DELETE BANNER
// =====================================================

router.delete(
  "/:bannerId",
  auth(Role.BRAND_OWNER, Role.BRANCH_MANAGER),
  validateRequest(bannerValidation.deleteBannerValidationSchema),
  bannerController.deleteBanner,
);

// =====================================================
// API 10 — UPDATE BANNER MEDIA ORDER
// =====================================================

router.patch(
  "/:bannerId/media/order",
  auth(Role.BRAND_OWNER, Role.BRANCH_MANAGER),
  validateRequest(bannerValidation.updateBannerMediaOrderValidationSchema),
  bannerController.updateBannerMediaOrder,
);
export const BannerRoutes = router;
