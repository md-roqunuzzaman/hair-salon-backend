import { Router } from "express";

import { Role } from "../../../../generated/prisma/client.js";

import { auth } from "../../middleware/auth.js";
import { validateRequest } from "../../middleware/validateRequest.js";

import { uploadController } from "./upload.controller.js";
import { uploadValidation } from "./upload.validation.js";

const router = Router();

router.post(
  "/images/presign",

  auth(Role.CUSTOMER, Role.STAFF, Role.BRANCH_MANAGER, Role.BRAND_OWNER),

  validateRequest(uploadValidation.presignImageUploadValidationSchema),

  uploadController.presignImageUpload,
);

router.post(
  "/images/confirm",
  auth(Role.CUSTOMER, Role.STAFF, Role.BRANCH_MANAGER, Role.BRAND_OWNER),
  validateRequest(uploadValidation.confirmImageUploadValidationSchema),
  uploadController.confirmImageUpload,
);

router.delete(
  "/images",

  auth(Role.CUSTOMER, Role.STAFF, Role.BRANCH_MANAGER, Role.BRAND_OWNER),

  validateRequest(uploadValidation.deleteImageValidationSchema),

  uploadController.deleteImage,
);

export const UploadRoutes = router;
