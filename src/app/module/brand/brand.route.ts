import { Router } from "express";

import { Role } from "../../../../generated/prisma/client.js";
import { auth } from "../../middleware/auth.js";
import { validateRequest } from "../../middleware/validateRequest.js";

import { brandController } from "./brand.controller.js";
import { brandValidation } from "./brand.validation.js";

const router = Router();

router.get("/", brandController.getBrand);

router.patch(
  "/",
  auth(Role.BRAND_OWNER),
  validateRequest(brandValidation.updateBrandValidationSchema),
  brandController.updateBrand,
);

export const BrandRoutes = router;
