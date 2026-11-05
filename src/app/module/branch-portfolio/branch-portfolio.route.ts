import { Router } from "express";
import { Role } from "../../../../generated/prisma/enums.js";
import { auth } from "../../middleware/auth.js";
import { branchPortfolioController } from "./branch-portfolio.controller.js";

const router = Router();

// =====================================================
// CUSTOMER — PUBLIC BRANCH PORTFOLIO
// =====================================================

router.get(
  "/:branchId/portfolio",
  branchPortfolioController.getBranchPortfolio,
);

// =====================================================
// BRAND OWNER — CREATE PORTFOLIO CASE
// =====================================================

router.post(
  "/:branchId/portfolio/cases",
  auth(Role.BRAND_OWNER),
  branchPortfolioController.createBranchPortfolioCase,
);

// =====================================================
// BRAND OWNER — UPDATE PORTFOLIO CASE
// =====================================================

router.patch(
  "/:branchId/portfolio/cases/:caseId",
  auth(Role.BRAND_OWNER),
  branchPortfolioController.updateBranchPortfolioCase,
);

// =====================================================
// BRAND OWNER — ADD PORTFOLIO IMAGES
// =====================================================

router.post(
  "/:branchId/portfolio/cases/:caseId/images",
  auth(Role.BRAND_OWNER),
  branchPortfolioController.addBranchPortfolioImages,
);

// =====================================================
// BRAND OWNER — REORDER IMAGES / SET COVER
// =====================================================

router.patch(
  "/:branchId/portfolio/cases/:caseId/images/order",
  auth(Role.BRAND_OWNER),
  branchPortfolioController.reorderBranchPortfolioImages,
);

// =====================================================
// BRAND OWNER — DELETE PORTFOLIO IMAGE
// =====================================================

router.delete(
  "/:branchId/portfolio/cases/:caseId/images/:imageId",
  auth(Role.BRAND_OWNER),
  branchPortfolioController.deleteBranchPortfolioImage,
);

router.get(
  "/:branchId/portfolio/manage",
  auth(Role.BRAND_OWNER),
  branchPortfolioController.getBranchPortfolioForManagement,
);

export const branchPortfolioRoutes = router;
