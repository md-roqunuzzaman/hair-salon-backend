import { NextFunction, Request, Response, Router } from "express";

import { Role } from "../../../../generated/prisma/client.js";

import { auth } from "../../middleware/auth.js";
import { validateRequest } from "../../middleware/validateRequest.js";

import { notificationController } from "./notification.controller.js";
import { notificationValidation } from "./notification.validation.js";

const router = Router();

const queryToBody = (req: Request, _res: Response, next: NextFunction) => {
  req.body = {
    ...req.query,
  };

  next();
};

router.get(
  "/",
  auth(Role.CUSTOMER, Role.STAFF, Role.BRANCH_MANAGER, Role.BRAND_OWNER),
  queryToBody,
  validateRequest(notificationValidation.getNotificationsValidationSchema),
  notificationController.getNotifications,
);
router.patch(
  "/read-all",
  auth(Role.CUSTOMER, Role.STAFF, Role.BRANCH_MANAGER, Role.BRAND_OWNER),
  notificationController.markAllAsRead,
);

router.patch(
  "/:notificationId/read",
  auth(Role.CUSTOMER, Role.STAFF, Role.BRANCH_MANAGER, Role.BRAND_OWNER),
  notificationController.markAsRead,
);

export const NotificationRoutes = router;
