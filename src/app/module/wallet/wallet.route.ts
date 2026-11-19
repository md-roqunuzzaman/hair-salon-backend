import { NextFunction, Request, Response, Router } from "express";

import { Role } from "../../../../generated/prisma/client.js";

import { auth } from "../../middleware/auth.js";
import { requireFeature } from "../../middleware/requireFeature.js";
import { validateRequest } from "../../middleware/validateRequest.js";

import { walletController } from "./wallet.controller.js";
import { walletValidation } from "./wallet.validation.js";

const router = Router();

const queryToBody = (req: Request, res: Response, next: NextFunction) => {
  req.body = {
    ...req.query,
  };

  next();
};

// =====================================================
// WALLET FEATURE LICENSE PROTECTION
// =====================================================
// WALLET disabled or expired:
// Block new top-ups and new payments. Preserve balance/history and
// remaining payments for existing obligations; service checks stay enforced.
// =====================================================

// =====================================================
// GET MY WALLET
// =====================================================

router.get("/", auth(Role.CUSTOMER), walletController.getMyWallet);

// =====================================================
// NORMAL APPOINTMENT - PAY NOW WITH WALLET
// =====================================================

router.post(
  "/:appointmentId/pay-with-wallet",
  auth(Role.CUSTOMER),
  requireFeature("WALLET"),
  validateRequest(walletValidation.payAppointmentWithWalletValidationSchema),
  walletController.payAppointmentWithWallet,
);

// =====================================================
// NORMAL DEPOSIT - REMAINING PAYMENT WITH WALLET
// =====================================================

router.post(
  "/:appointmentId/remaining-payment/wallet",
  auth(Role.CUSTOMER),
  validateRequest(
    walletValidation.payAppointmentRemainingWithWalletValidationSchema,
  ),
  walletController.payAppointmentRemainingWithWallet,
);

// =====================================================
// WALLET TRANSACTIONS
// =====================================================

router.get(
  "/transactions",
  auth(Role.CUSTOMER),
  queryToBody,
  validateRequest(walletValidation.getWalletTransactionsValidationSchema),
  walletController.getMyTransactions,
);

// =====================================================
// WALLET TOP-UP
// =====================================================

router.post(
  "/topups",
  auth(Role.CUSTOMER),
  requireFeature("WALLET"),
  validateRequest(walletValidation.createWalletTopupValidationSchema),
  walletController.createTopup,
);

// =====================================================
// GROUP PURCHASE DEPOSIT
// REMAINING PAYMENT WITH WALLET
// =====================================================

router.post(
  "/group-purchases/:purchaseId/remaining-payment/wallet",
  auth(Role.CUSTOMER),
  validateRequest(
    walletValidation.payGroupPurchaseRemainingWithWalletValidationSchema,
  ),
  walletController.payGroupPurchaseRemainingWithWallet,
);

export const WalletRoutes = router;
