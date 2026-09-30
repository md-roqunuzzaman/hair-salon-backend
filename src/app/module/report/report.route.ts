import { NextFunction, Request, Response, Router } from "express";

import { Role } from "../../../../generated/prisma/client.js";

import { auth } from "../../middleware/auth.js";
import { validateRequest } from "../../middleware/validateRequest.js";

import { reportController } from "./report.controller.js";
import { reportValidation } from "./report.validation.js";

const router = Router();

const queryToBody = (req: Request, res: Response, next: NextFunction) => {
  req.body = {
    ...req.query,
  };

  next();
};

router.get(
  "/branches",

  auth(Role.BRAND_OWNER),

  queryToBody,

  validateRequest(reportValidation.getBranchReportValidationSchema),

  reportController.getBranchReport,
);

router.get(
  "/booking-conversion",

  auth(Role.BRAND_OWNER, Role.BRANCH_MANAGER),

  queryToBody,

  validateRequest(reportValidation.getBookingConversionReportValidationSchema),

  reportController.getBookingConversionReport,
);
router.get(
  "/services",
  auth(Role.BRAND_OWNER),
  reportController.getServiceReport,
);

router.get(
  "/packages",
  auth(Role.BRAND_OWNER),
  reportController.getPackageReport,
);

router.get(
  "/group-purchases",
  auth(Role.BRAND_OWNER),
  reportController.getGroupPurchaseReport,
);

router.get(
  "/staff",
  auth(Role.BRAND_OWNER, Role.BRANCH_MANAGER),
  reportController.getStaffReport,
);
export const ReportRoutes = router;
