import { Router } from "express";

import { Role } from "../../../../generated/prisma/client.js";

import { auth } from "../../middleware/auth.js";

import { validateRequest } from "../../middleware/validateRequest.js";

import { serviceController } from "./service.controller.js";

import { serviceValidation } from "./service.validation.js";

const router = Router();

router.post(
  "/",
  auth(Role.BRAND_OWNER),
  validateRequest(serviceValidation.createServiceValidationSchema),
  serviceController.createService,
);

router.get("/", auth(Role.BRAND_OWNER), serviceController.getServices);

router.get("/:serviceId", serviceController.getServiceById);

router.patch(
  "/:serviceId",
  auth(Role.BRAND_OWNER),
  validateRequest(serviceValidation.updateServiceValidationSchema),
  serviceController.updateService,
);

router.patch(
  "/:serviceId/status",
  auth(Role.BRAND_OWNER),
  validateRequest(serviceValidation.updateServiceStatusValidationSchema),
  serviceController.updateServiceStatus,
);

router.put(
  "/:serviceId/branches",
  auth(Role.BRAND_OWNER),
  validateRequest(serviceValidation.assignServiceBranchesValidationSchema),
  serviceController.assignServiceToBranches,
);

router.get("/:branchId/services", serviceController.getBranchServices);
export const ServiceRoutes = router;
