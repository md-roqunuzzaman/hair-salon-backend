import { Router } from "express";
import { Role } from "../../../../generated/prisma/client.js";

import { auth } from "../../middleware/auth.js";
import { validateRequest } from "../../middleware/validateRequest.js";

import { auditLogController } from "./auditLog.controller.js";
import { auditLogValidation } from "./auditLog.validation.js";

const router = Router();

router.get(
  "/",
  auth(Role.BRAND_OWNER),

  // Convert GET query into body for existing validateRequest middleware
  (req, _res, next) => {
    req.body = req.query;
    next();
  },

  validateRequest(auditLogValidation.getAuditLogsValidationSchema),

  auditLogController.getAuditLogs,
);

export const AuditLogRoutes = router;
