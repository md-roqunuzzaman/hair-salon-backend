import { NextFunction, Request, Response, Router } from "express";

import { Role } from "../../../../generated/prisma/client.js";

import { auth } from "../../middleware/auth.js";
import { validateRequest } from "../../middleware/validateRequest.js";

import { paymentController } from "./payment.controller.js";
import { paymentValidation } from "./payment.validation.js";

const router = Router();
const queryToBody = (req: Request, res: Response, next: NextFunction) => {
  req.body = {
    ...req.query,
  };

  next();
};
router.post(
  "/stripe/create-intent",
  auth(Role.CUSTOMER),
  validateRequest(paymentValidation.createStripeIntentValidationSchema),
  paymentController.createStripeIntent,
);
router.get(
  "/my",
  auth(Role.CUSTOMER),
  queryToBody,
  validateRequest(paymentValidation.getMyPaymentsValidationSchema),
  paymentController.getMyPayments,
);

router.post(
  "/:paymentId/refund",
  auth(Role.BRAND_OWNER),
  validateRequest(paymentValidation.refundPaymentValidationSchema),
  paymentController.refundPayment,
);
router.get(
  "/:paymentId",
  auth(Role.CUSTOMER, Role.BRANCH_MANAGER, Role.BRAND_OWNER),
  paymentController.getPaymentById,
);

export const PaymentRoutes = router;
