import { NextFunction, Request, Response, Router } from "express";

import { Role } from "../../../../generated/prisma/client.js";
import { auth } from "../../middleware/auth.js";

import { walletController } from "./wallet.controller.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { walletValidation } from "./wallet.validation.js";

const router = Router();
const queryToBody = (req: Request, res: Response, next: NextFunction) => {
  req.body = {
    ...req.query,
  };

  next();
};
router.get("/", auth(Role.CUSTOMER), walletController.getMyWallet);

router.post(
  "/:appointmentId/pay-with-wallet",
  auth(Role.CUSTOMER),
  validateRequest(walletValidation.payAppointmentWithWalletValidationSchema),
  walletController.payAppointmentWithWallet,
);

router.get(
  "/transactions",
  auth(Role.CUSTOMER),
  queryToBody,
  validateRequest(walletValidation.getWalletTransactionsValidationSchema),
  walletController.getMyTransactions,
);

router.post(
  "/topups",
  auth(Role.CUSTOMER),
  validateRequest(walletValidation.createWalletTopupValidationSchema),
  walletController.createTopup,
);
export const WalletRoutes = router;
