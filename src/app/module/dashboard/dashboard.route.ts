import { NextFunction, Request, Response, Router } from "express";

import { Role } from "../../../../generated/prisma/client.js";

import { auth } from "../../middleware/auth.js";
import { validateRequest } from "../../middleware/validateRequest.js";

import { dashboardController } from "./dashboard.controller.js";
import { dashboardValidation } from "./dashboard.validation.js";

const router = Router();

const queryToBody = (req: Request, res: Response, next: NextFunction) => {
  req.body = {
    ...req.query,
  };

  next();
};

router.get(
  "/",
  auth(Role.BRAND_OWNER),
  queryToBody,
  validateRequest(dashboardValidation.getDashboardValidationSchema),
  dashboardController.getBrandDashboard,
);

export const DashboardRoutes = router;
