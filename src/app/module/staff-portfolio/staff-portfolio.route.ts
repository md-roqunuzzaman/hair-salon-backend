import { Router } from "express";
import { staffPortfolioController } from "./staff-portfolio.controller.js";
import { auth } from "../../middleware/auth.js";
import { Role } from "../../../../generated/prisma/enums.js";

const router = Router();

// =====================================================
// PUBLIC STAFF PORTFOLIO
// GET /api/v1/staff/:staffId/portfolio
// =====================================================
// API 05 — Create portfolio case
router.post(
  "/:staffId/portfolio/cases",
  auth(Role.BRAND_OWNER),
  staffPortfolioController.createPortfolioCase,
);
router.get("/:staffId/portfolio", staffPortfolioController.getStaffPortfolio);

// API 02 — Published portfolio cases
router.get(
  "/:staffId/portfolio/cases",
  staffPortfolioController.getPublishedPortfolioCases,
);
// API 04 — Admin cases
// IMPORTANT: Register before /:caseId
router.get(
  "/:staffId/portfolio/cases/admin",
  auth(Role.BRAND_OWNER, Role.BRANCH_MANAGER),
  staffPortfolioController.getAdminPortfolioCases,
);

// API 03 — Single published portfolio case
router.get(
  "/:staffId/portfolio/cases/:caseId",
  staffPortfolioController.getPublishedPortfolioCaseById,
);

// API 06 — Update portfolio case
router.patch(
  "/:staffId/portfolio/cases/:caseId",
  auth(Role.BRAND_OWNER),
  staffPortfolioController.updatePortfolioCase,
);

// API 07 — Add portfolio images
router.post(
  "/:staffId/portfolio/cases/:caseId/images",
  auth(Role.BRAND_OWNER),
  staffPortfolioController.addPortfolioImages,
);

// API 08 — Reorder images / set cover
router.patch(
  "/:staffId/portfolio/cases/:caseId/images/order",
  auth(Role.BRAND_OWNER),
  staffPortfolioController.reorderPortfolioImages,
);

// API 09 — Delete portfolio image
router.delete(
  "/:staffId/portfolio/cases/:caseId/images/:imageId",
  auth(Role.BRAND_OWNER),
  staffPortfolioController.deletePortfolioImage,
);

// =====================================================
// API 10 — DELETE STAFF PORTFOLIO CASE
// =====================================================

router.delete(
  "/:staffId/portfolio/cases/:caseId",
  auth(Role.BRAND_OWNER),
  staffPortfolioController.deletePortfolioCase,
);
export const staffPortfolioRoutes = router;
