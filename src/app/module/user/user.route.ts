import { Router } from "express";

import { auth } from "../../middleware/auth.js";
import { userController } from "./user.controller.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { userValidation } from "./user.validation.js";

const router = Router();

router.get("/me", auth(), userController.getMe);
router.patch(
  "/me",
  auth(),
  validateRequest(userValidation.updateProfileValidationSchema),
  userController.updateMe,
);

router.patch(
  "/me/password",
  auth(),
  validateRequest(userValidation.changePasswordValidationSchema),
  userController.changePassword,
);
export const UserRoutes = router;
