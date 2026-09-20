import { z } from "zod";

const registerValidationSchema = z.object({
  body: z.object({
    name: z
      .string("Not A String")
      .min(3, "Name must be at least 3 characters long!!")
      .max(50, "Name must not exceed 50 characters"),

    email: z.email("Not email !!"),

    phone: z
      .string()
      .min(8, "Phone number must be at least 8 characters")
      .max(20, "Phone number must not exceed 20 characters")
      .optional(),

    password: z
      .string()
      .min(8, "Password Must Minimum 8 Characters Long.")
      .regex(/[a-z]/, "Password must contain at least 1 Lowercase Letter")
      .regex(/[A-Z]/, "Password must contain at least 1 Uppercase Letter")
      .regex(/[0-9]/, "Password must contain at least 1 Number")
      .regex(
        /[^A-Za-z0-9]/,
        "Password must contain at least 1 Special Character",
      ),
  }),
});

const LoginZodSchema = z.object({
  body: z.object({
    email: z.email("Not email !!"),

    password: z
      .string()
      .min(8, "Password Must Minimum 8 Characters Long.")
      .regex(/[a-z]/, "Password must contain at least 1 Lowercase Letter")
      .regex(/[A-Z]/, "Password must contain at least 1 Uppercase Letter")
      .regex(/[0-9]/, "Password must contain at least 1 Number")
      .regex(
        /[^A-Za-z0-9]/,
        "Password must contain at least 1 Special Character",
      ),
  }),
});

const forgotPasswordValidationSchema = z.object({
  body: z.object({
    email: z.email("Invalid email address"),
  }),
});

const verifyResetOtpValidationSchema = z.object({
  body: z.object({
    email: z.email("Invalid email address"),

    otp: z.string().regex(/^\d{6}$/, "OTP must be exactly 6 digits"),
  }),
});

const resetPasswordValidationSchema = z.object({
  body: z.object({
    resetToken: z.string().min(1, "Reset token is required"),

    newPassword: z
      .string()
      .min(8, "Password must be minimum 8 characters")
      .regex(/[a-z]/, "Password must contain at least 1 lowercase letter")
      .regex(/[A-Z]/, "Password must contain at least 1 uppercase letter")
      .regex(/[0-9]/, "Password must contain at least 1 number")
      .regex(
        /[^A-Za-z0-9]/,
        "Password must contain at least 1 special character",
      ),
  }),
});
export const authValidation = {
  registerValidationSchema,
  LoginZodSchema,
  forgotPasswordValidationSchema,
  verifyResetOtpValidationSchema,
  resetPasswordValidationSchema,
};
