import { Router } from "express";
import { authValidation } from "./auth.validation.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { authController } from "./auth.controller.js";
import { auth } from "../../middleware/auth.js";

const router = Router();

router.post(
  "/register",
  validateRequest(authValidation.registerValidationSchema),
  authController.registerUser,
);

router.post(
  "/login",
  validateRequest(authValidation.LoginZodSchema),
  authController.loginUser,
);

router.post("/logout", auth(), authController.logoutUser);
router.post("/refresh-token", authController.refreshToken);
router.post(
  "/forgot-password",
  validateRequest(authValidation.forgotPasswordValidationSchema),
  authController.forgotPassword,
);
router.post(
  "/verify-reset-otp",
  validateRequest(authValidation.verifyResetOtpValidationSchema),
  authController.verifyResetOtp,
);
router.post(
  "/reset-password",
  validateRequest(authValidation.resetPasswordValidationSchema),
  authController.resetPassword,
);
export const authRoutes = router;
