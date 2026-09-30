import { NextFunction, Request, Response, Router } from "express";

import { Role } from "../../../../generated/prisma/client.js";

import { auth } from "../../middleware/auth.js";
import { validateRequest } from "../../middleware/validateRequest.js";

import { appointmentController } from "./appointment.controller.js";
import { appointmentValidation } from "./appointment.validation.js";
import { walletValidation } from "../wallet/wallet.validation.js";
import { walletController } from "../wallet/wallet.controller.js";
import { reviewValidation } from "../review/review.validation.js";
import { reviewController } from "../review/review.controller.js";

const router = Router();

router.post(
  "/pay-now",
  auth(Role.CUSTOMER),
  validateRequest(appointmentValidation.createPayNowValidationSchema),
  appointmentController.createPayNowAppointment,
);

router.post(
  "/reserve",
  auth(Role.CUSTOMER),
  validateRequest(appointmentValidation.createReserveValidationSchema),
  appointmentController.createReserveAppointment,
);

const queryToBody = (req: Request, res: Response, next: NextFunction) => {
  req.body = req.query;
  next();
};

router.get(
  "/my",
  auth(Role.CUSTOMER),
  queryToBody,
  validateRequest(appointmentValidation.getMyAppointmentsValidationSchema),
  appointmentController.getMyAppointments,
);

router.get(
  "/:appointmentId",
  auth(Role.CUSTOMER, Role.STAFF, Role.BRANCH_MANAGER, Role.BRAND_OWNER),
  appointmentController.getAppointmentById,
);

router.post(
  "/:appointmentId/cancel",
  auth(Role.CUSTOMER, Role.BRANCH_MANAGER, Role.BRAND_OWNER),
  validateRequest(appointmentValidation.cancelAppointmentValidationSchema),
  appointmentController.cancelAppointment,
);

router.post(
  "/:appointmentId/reschedule",
  auth(Role.CUSTOMER),
  validateRequest(appointmentValidation.rescheduleAppointmentValidationSchema),
  appointmentController.rescheduleAppointment,
);

router.get(
  "/:appointmentId/qr",
  auth(Role.CUSTOMER),
  appointmentController.getAppointmentQr,
);

router.post(
  "/verify-qr",
  auth(Role.STAFF, Role.BRANCH_MANAGER, Role.BRAND_OWNER),
  validateRequest(appointmentValidation.verifyQrValidationSchema),
  appointmentController.verifyQr,
);

router.post(
  "/:appointmentId/complete",
  auth(Role.STAFF, Role.BRANCH_MANAGER, Role.BRAND_OWNER),
  validateRequest(appointmentValidation.completeAppointmentValidationSchema),
  appointmentController.completeAppointment,
);

router.post(
  "/:appointmentId/no-show",
  auth(Role.BRANCH_MANAGER, Role.BRAND_OWNER),
  validateRequest(appointmentValidation.markNoShowValidationSchema),
  appointmentController.markNoShow,
);

router.get(
  "/",
  auth(Role.BRAND_OWNER),
  queryToBody,
  validateRequest(appointmentValidation.getAllAppointmentsValidationSchema),
  appointmentController.getAllAppointments,
);

router.post(
  "/:appointmentId/pay-with-wallet",
  auth(Role.CUSTOMER),
  validateRequest(walletValidation.payAppointmentWithWalletValidationSchema),
  walletController.payAppointmentWithWallet,
);

router.post(
  "/:appointmentId/reviews",
  auth(Role.CUSTOMER),
  validateRequest(reviewValidation.createReviewValidationSchema),
  reviewController.createReview,
);
export const AppointmentRoutes = router;
