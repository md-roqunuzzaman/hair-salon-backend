import { Router } from "express";

import { Role } from "../../../../generated/prisma/client.js";

import { auth } from "../../middleware/auth.js";
import { validateRequest } from "../../middleware/validateRequest.js";

import { reviewController } from "./review.controller.js";
import { reviewValidation } from "./review.validation.js";

const router = Router();

// =====================================================
// CUSTOMER REVIEWS
// =====================================================

router.get(
  "/my",
  auth(Role.CUSTOMER),
  validateRequest(reviewValidation.getReviewsValidationSchema),
  reviewController.getMyReviews,
);

// =====================================================
// MERCHANT REVIEW MODERATION LISTING
// =====================================================

router.get(
  "/moderation",
  auth(Role.BRAND_OWNER, Role.BRANCH_MANAGER),
  validateRequest(reviewValidation.getModerationReviewsValidationSchema),
  reviewController.getModerationReviews,
);

// =====================================================
// REVIEW REPLIES
// =====================================================

router.put(
  "/:reviewId/reply",
  auth(Role.BRAND_OWNER, Role.BRANCH_MANAGER),
  validateRequest(reviewValidation.reviewReplyValidationSchema),
  reviewController.saveReviewReply,
);

router.delete(
  "/:reviewId/reply",
  auth(Role.BRAND_OWNER, Role.BRANCH_MANAGER),
  reviewController.deleteReviewReply,
);

// =====================================================
// REVIEW MODERATION ACTION
// =====================================================

router.patch(
  "/:reviewId/moderation",
  auth(Role.BRAND_OWNER),
  validateRequest(reviewValidation.moderateReviewValidationSchema),
  reviewController.moderateReview,
);

// =====================================================
// CUSTOMER REVIEW MANAGEMENT
// =====================================================

router.patch(
  "/:reviewId",
  auth(Role.CUSTOMER),
  validateRequest(reviewValidation.updateReviewValidationSchema),
  reviewController.updateReview,
);

router.delete("/:reviewId", auth(Role.CUSTOMER), reviewController.deleteReview);

// =====================================================
// COMPLETED APPOINTMENTS AWAITING CUSTOMER REVIEWS
// =====================================================

router.get("/pending", auth(Role.CUSTOMER), reviewController.getPendingReviews);

export const ReviewRoutes = router;
