import { Router } from "express";

import { Role } from "../../../../generated/prisma/client.js";

import { auth } from "../../middleware/auth.js";
import { validateRequest } from "../../middleware/validateRequest.js";

import { reviewController } from "./review.controller.js";
import { reviewValidation } from "./review.validation.js";

const router = Router();
router.get(
  "/my",
  auth(Role.CUSTOMER),
  validateRequest(reviewValidation.getReviewsValidationSchema),
  reviewController.getMyReviews,
);

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

router.patch(
  "/:reviewId/moderation",
  auth(Role.BRAND_OWNER),
  validateRequest(reviewValidation.moderateReviewValidationSchema),
  reviewController.moderateReview,
);

router.patch(
  "/:reviewId",
  auth(Role.CUSTOMER),
  validateRequest(reviewValidation.updateReviewValidationSchema),
  reviewController.updateReview,
);

router.delete("/:reviewId", auth(Role.CUSTOMER), reviewController.deleteReview);

export const ReviewRoutes = router;
