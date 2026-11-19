import { NextFunction, Request, Response, Router } from "express";

import { Role } from "../../../../generated/prisma/client.js";

import { auth } from "../../middleware/auth.js";
import { requireFeature } from "../../middleware/requireFeature.js";
import { validateRequest } from "../../middleware/validateRequest.js";

import { paymentController } from "./payment.controller.js";
import { paymentValidation } from "./payment.validation.js";

const router = Router();

// =====================================================
// QUERY HELPER
// =====================================================

const queryToBody = (req: Request, res: Response, next: NextFunction) => {
  req.body = {
    ...req.query,
  };

  next();
};

// =====================================================
// CREATE NORMAL STRIPE PAYMENT INTENT
// =====================================================
//
// Normal appointment payment remains available.
// No feature-specific license required.
// =====================================================

router.post(
  "/stripe/create-intent",
  auth(Role.CUSTOMER),
  validateRequest(paymentValidation.createStripeIntentValidationSchema),
  paymentController.createStripeIntent,
);

// =====================================================
// CREATE GROUP PURCHASE STRIPE PAYMENT INTENT
// =====================================================
//
// Requires GROUP_BUYING feature.
// Disabled / expired => 403.
// =====================================================

router.post(
  "/group-purchase/create-intent",
  auth(Role.CUSTOMER),
  requireFeature("GROUP_BUYING"),
  validateRequest(
    paymentValidation.createGroupPurchaseStripeIntentValidationSchema,
  ),
  paymentController.createGroupPurchaseStripeIntent,
);

// =====================================================
// GET MY PAYMENTS
// =====================================================
//
// Existing payment history remains accessible.
// =====================================================

router.get(
  "/my",
  auth(Role.CUSTOMER),
  queryToBody,
  validateRequest(paymentValidation.getMyPaymentsValidationSchema),
  paymentController.getMyPayments,
);

// =====================================================
// REFUND PAYMENT
// =====================================================

// router.post(
//   "/:paymentId/refund",
//   auth(Role.BRAND_OWNER),
//   validateRequest(
//     paymentValidation.refundPaymentValidationSchema,
//   ),
//   paymentController.refundPayment,
// );

// =====================================================
// GET PAYMENT BY ID
// =====================================================

router.get(
  "/:paymentId",
  auth(Role.CUSTOMER, Role.BRANCH_MANAGER, Role.BRAND_OWNER),
  paymentController.getPaymentById,
);

// =====================================================
// CREATE APPOINTMENT REMAINING STRIPE PAYMENT
// =====================================================
//
// Existing appointment remaining payment.
// No feature-specific license required.
// =====================================================

router.post(
  "/appointments/:appointmentId/remaining-payment/stripe",
  auth(Role.CUSTOMER),
  validateRequest(
    paymentValidation.createAppointmentRemainingStripeIntentValidationSchema,
  ),
  paymentController.createAppointmentRemainingStripeIntent,
);

// =====================================================
// CREATE GROUP PURCHASE REMAINING STRIPE PAYMENT
// =====================================================
//
// Existing group purchase settlement.
//
// Do not globally block this endpoint when
// GROUP_BUYING expires, because customers may
// already have outstanding payment obligations.
//
// Authorization, purchase ownership, payment
// status and remaining balance must still be
// validated in the service layer.
// =====================================================

router.post(
  "/group-purchases/:purchaseId/remaining-payment/stripe",
  auth(Role.CUSTOMER),
  validateRequest(
    paymentValidation.createGroupPurchaseRemainingStripeIntentValidationSchema,
  ),
  paymentController.createGroupPurchaseRemainingStripeIntent,
);

// =====================================================
// CANCEL PENDING REMAINING STRIPE PAYMENT
// =====================================================
//
// Allows cancellation of existing pending
// remaining-payment attempts.
//
// Must remain available even if a related
// feature license becomes disabled.
// =====================================================

router.post(
  "/:paymentId/cancel-remaining-stripe",
  auth(Role.CUSTOMER),
  paymentController.cancelRemainingStripePayment,
);

// =====================================================
// EXPORT ROUTES
// =====================================================

export const PaymentRoutes = router;
