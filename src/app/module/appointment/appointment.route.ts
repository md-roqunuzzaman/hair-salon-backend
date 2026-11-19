import { NextFunction, Request, Response, Router } from "express";

import { Role } from "../../../../generated/prisma/client.js";

import { auth } from "../../middleware/auth.js";
import { requireFeature } from "../../middleware/requireFeature.js";
import { validateRequest } from "../../middleware/validateRequest.js";

import { appointmentController } from "./appointment.controller.js";
import { appointmentValidation } from "./appointment.validation.js";

import { walletValidation } from "../wallet/wallet.validation.js";
import { walletController } from "../wallet/wallet.controller.js";

import { reviewValidation } from "../review/review.validation.js";
import { reviewController } from "../review/review.controller.js";

const router = Router();

// =====================================================
// QUERY HELPER
// =====================================================

const queryToBody = (req: Request, res: Response, next: NextFunction) => {
  req.body = req.query;
  next();
};

// =====================================================
// CREATE PAY NOW APPOINTMENT
// =====================================================

router.post(
  "/pay-now",
  auth(Role.CUSTOMER),
  validateRequest(appointmentValidation.createPayNowValidationSchema),
  appointmentController.createPayNowAppointment,
);

// =====================================================
// CREATE DEPOSIT APPOINTMENT
// =====================================================

router.post(
  "/deposit",
  auth(Role.CUSTOMER),
  validateRequest(
    appointmentValidation.createDepositAppointmentValidationSchema,
  ),
  appointmentController.createDepositAppointment,
);

// =====================================================
// CREATE RESERVE APPOINTMENT
// =====================================================

router.post(
  "/reserve",
  auth(Role.CUSTOMER),
  validateRequest(appointmentValidation.createReserveValidationSchema),
  appointmentController.createReserveAppointment,
);

// =====================================================
// GET MY APPOINTMENTS
// =====================================================

router.get(
  "/my",
  auth(Role.CUSTOMER),
  queryToBody,
  validateRequest(appointmentValidation.getMyAppointmentsValidationSchema),
  appointmentController.getMyAppointments,
);

// =====================================================
// RECORD REMAINING PAYMENT
// =====================================================

router.post(
  "/:appointmentId/remaining-payment",
  auth(Role.BRAND_OWNER, Role.BRANCH_MANAGER, Role.STAFF),
  validateRequest(appointmentValidation.recordRemainingPaymentValidationSchema),
  appointmentController.recordRemainingPayment,
);

// =====================================================
// GET APPOINTMENT BY ID
// =====================================================

router.get(
  "/:appointmentId",
  auth(Role.CUSTOMER, Role.STAFF, Role.BRANCH_MANAGER, Role.BRAND_OWNER),
  appointmentController.getAppointmentById,
);

// =====================================================
// CANCEL APPOINTMENT
// =====================================================

router.post(
  "/:appointmentId/cancel",
  auth(Role.CUSTOMER, Role.BRANCH_MANAGER, Role.BRAND_OWNER),
  validateRequest(appointmentValidation.cancelAppointmentValidationSchema),
  appointmentController.cancelAppointment,
);

// =====================================================
// RESCHEDULE APPOINTMENT
// =====================================================

router.post(
  "/:appointmentId/reschedule",
  auth(Role.CUSTOMER),
  validateRequest(appointmentValidation.rescheduleAppointmentValidationSchema),
  appointmentController.rescheduleAppointment,
);

// =====================================================
// GET APPOINTMENT QR
// =====================================================

router.get(
  "/:appointmentId/qr",
  auth(Role.CUSTOMER),
  appointmentController.getAppointmentQr,
);

// =====================================================
// VERIFY APPOINTMENT QR
// =====================================================

router.post(
  "/verify-qr",
  auth(Role.STAFF, Role.BRANCH_MANAGER, Role.BRAND_OWNER),
  validateRequest(appointmentValidation.verifyQrValidationSchema),
  appointmentController.verifyQr,
);

// =====================================================
// COMPLETE APPOINTMENT
// =====================================================

// router.post(
//   "/:appointmentId/complete",
//   auth(Role.STAFF, Role.BRANCH_MANAGER, Role.BRAND_OWNER),
//   validateRequest(
//     appointmentValidation.completeAppointmentValidationSchema,
//   ),
//   appointmentController.completeAppointment,
// );

// =====================================================
// MARK NO SHOW
// =====================================================

router.post(
  "/:appointmentId/no-show",
  auth(Role.BRANCH_MANAGER, Role.BRAND_OWNER),
  validateRequest(appointmentValidation.markNoShowValidationSchema),
  appointmentController.markNoShow,
);

// =====================================================
// GET ALL APPOINTMENTS
// =====================================================

router.get(
  "/",
  auth(Role.BRAND_OWNER),
  queryToBody,
  validateRequest(appointmentValidation.getAllAppointmentsValidationSchema),
  appointmentController.getAllAppointments,
);

// =====================================================
// PAY APPOINTMENT WITH WALLET
// =====================================================
//
// Requires WALLET feature.
// Disabled / expired => 403.
// =====================================================

router.post(
  "/:appointmentId/pay-with-wallet",
  auth(Role.CUSTOMER),
  requireFeature("WALLET"),
  validateRequest(walletValidation.payAppointmentWithWalletValidationSchema),
  walletController.payAppointmentWithWallet,
);

// =====================================================
// CREATE APPOINTMENT REVIEW / COMMENT
// =====================================================
//
// Requires REVIEWS feature.
// Disabled / expired => 403.
// =====================================================

router.post(
  "/:appointmentId/reviews",
  auth(Role.CUSTOMER),
  requireFeature("REVIEWS"),
  validateRequest(reviewValidation.createReviewValidationSchema),
  reviewController.createReview,
);

// =====================================================
// EXPORT ROUTES
// =====================================================

export const AppointmentRoutes = router;
