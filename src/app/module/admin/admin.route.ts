import { NextFunction, Request, Response, Router } from "express";

import { Role } from "../../../../generated/prisma/client.js";

import { auth } from "../../middleware/auth.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { adminUserValidation } from "./admin.validation.js";
import { adminUserController } from "./admin.controller.js";

const router = Router();

const queryToBody = (req: Request, res: Response, next: NextFunction) => {
  req.body = req.query;
  next();
};

router.get(
  "/",
  auth(Role.BRAND_OWNER),
  queryToBody,
  validateRequest(adminUserValidation.getAdminUsersValidationSchema),
  adminUserController.getAdminUsers,
);

router.get(
  "/:userId",
  auth(Role.BRAND_OWNER),
  adminUserController.getAdminUserById,
);

router.patch(
  "/:userId/status",
  auth(Role.BRAND_OWNER),
  validateRequest(adminUserValidation.updateAdminUserStatusValidationSchema),
  adminUserController.updateAdminUserStatus,
);

export const AdminUserRoutes = router;
