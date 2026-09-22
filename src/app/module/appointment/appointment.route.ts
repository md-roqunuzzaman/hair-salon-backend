import { NextFunction, Request, Response, Router } from "express";

import { Role } from "../../../../generated/prisma/client.js";

import { auth } from "../../middleware/auth.js";
import { validateRequest } from "../../middleware/validateRequest.js";

import { appointmentController } from "./appointment.controller.js";
import { appointmentValidation } from "./appointment.validation.js";

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

export const AppointmentRoutes = router;
