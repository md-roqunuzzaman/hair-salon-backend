import { Router } from "express";
import { Role } from "../../../../generated/prisma/client.js";
import { auth } from "../../middleware/auth.js";
import { cancellationRefundController as c } from "./cancellation-refund.controller.js";
const router = Router();
router.get("/branches/:branchId/service-policy", c.displayService);
router.get(
  "/branches/:branchId/group-purchase-refund-policy",
  c.displayGroupRefund,
);
router.get(
  "/branches/:branchId/group-purchase-cancellation-policy",
  c.displayGroupCancellation,
);
router.get(
  "/appointments/:appointmentId/preview",
  auth(Role.CUSTOMER),
  c.appointmentPreview,
);
router.get(
  "/group-purchases/:groupPurchaseId/refund-preview",
  auth(Role.CUSTOMER),
  c.groupPreview,
);
router.post(
  "/appointments/:appointmentId/cancel",
  auth(Role.CUSTOMER),
  c.cancelAppointment,
);
router.post(
  "/group-purchase-appointments/:appointmentId/cancel",
  auth(Role.CUSTOMER),
  c.cancelAppointment,
);
router.post(
  "/group-purchases/:groupPurchaseId/refund-request",
  auth(Role.CUSTOMER),
  c.requestGroupRefund,
);
router.post("/group-purchases/checkout", auth(Role.CUSTOMER), c.checkout);
export const CancellationRefundRoutes = router;
