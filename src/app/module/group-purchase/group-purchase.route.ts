import { Router } from "express";

import { Role } from "../../../../generated/prisma/client.js";

import { auth } from "../../middleware/auth.js";
import { requireFeature } from "../../middleware/requireFeature.js";
import { validateRequest } from "../../middleware/validateRequest.js";

import { groupPurchaseController } from "./group-purchase.controller.js";
import { groupPurchaseValidation } from "./group-purchase.validation.js";

import { walletValidation } from "../wallet/wallet.validation.js";
import { walletController } from "../wallet/wallet.controller.js";

const router = Router();

// =====================================================
// GROUP BUYING FEATURE LICENSE POLICY
// =====================================================
//
// GROUP_BUYING enabled:
//   - Create new Group Purchases
//   - Pay new Group Purchases
//   - Book appointments from Group Purchases
//
// GROUP_BUYING disabled or expired:
//   - Block new purchases
//   - Preserve redemption of existing fully paid vouchers
//   - Allow customers to view existing purchases
//   - Allow authorized managers to record outstanding
//     payments for existing purchases
//
// WALLET payments additionally require WALLET license.
//
// Do not globally protect this router because existing
// financial obligations must remain accessible.
//
// =====================================================

// =====================================================
// 1. CREATE GROUP PURCHASE
// Requires GROUP_BUYING
// =====================================================

router.post(
  "/",
  auth(Role.CUSTOMER),
  requireFeature("GROUP_BUYING"),
  validateRequest(groupPurchaseValidation.createGroupPurchaseValidationSchema),
  groupPurchaseController.createGroupPurchase,
);

// =====================================================
// 2. GET MY GROUP PURCHASES
// Available even when GROUP_BUYING expires
// =====================================================

router.get(
  "/my",
  auth(Role.CUSTOMER),
  groupPurchaseController.getMyGroupPurchases,
);

// =====================================================
// 3. GET GROUP PURCHASE BY ID
// Available even when GROUP_BUYING expires
// =====================================================

router.get(
  "/:purchaseId",
  auth(Role.CUSTOMER, Role.BRANCH_MANAGER, Role.BRAND_OWNER),
  groupPurchaseController.getGroupPurchaseById,
);

// =====================================================
// 4. PAY GROUP PURCHASE WITH WALLET
// Requires GROUP_BUYING + WALLET
// =====================================================

router.post(
  "/:purchaseId/pay-with-wallet",
  auth(Role.CUSTOMER),
  requireFeature("GROUP_BUYING"),
  requireFeature("WALLET"),
  validateRequest(walletValidation.payGroupPurchaseWithWalletValidationSchema),
  walletController.payGroupPurchaseWithWallet,
);

// =====================================================
// 5. BOOK APPOINTMENT FROM GROUP PURCHASE
// Existing fully paid vouchers remain redeemable after license expiry.
// =====================================================

router.post(
  "/:purchaseId/book-appointment",
  auth(Role.CUSTOMER),
  validateRequest(
    groupPurchaseValidation.createGroupPurchaseAppointmentValidationSchema,
  ),
  groupPurchaseController.createGroupPurchaseAppointment,
);

// =====================================================
// 6. RECORD GROUP PURCHASE REMAINING PAYMENT
// Does NOT require GROUP_BUYING license
// =====================================================
//
// Existing outstanding payments must remain settleable
// even after GROUP_BUYING expires.
//
// Authorization, QR verification, payment-state checks,
// and duplicate-payment protection remain enforced
// by the existing application logic.
//
// =====================================================

router.post(
  "/:purchaseId/remaining-payment",
  auth(Role.BRAND_OWNER, Role.BRANCH_MANAGER),
  validateRequest(
    groupPurchaseValidation.recordGroupPurchaseRemainingPaymentValidationSchema,
  ),
  groupPurchaseController.recordGroupPurchaseRemainingPayment,
);

export const GroupPurchaseRoutes = router;
