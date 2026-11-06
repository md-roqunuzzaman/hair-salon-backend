import { z } from "zod";
import { isWithinBcryptPasswordLimit } from "../../utils/password-security.js";
import { parsePhoneNumberFromString } from "libphonenumber-js";
const registerValidationSchema = z.object({
  body: z.object({
    name: z
      .string("Not A String")
      .min(3, "Name must be at least 3 characters long!!")
      .max(50, "Name must not exceed 50 characters"),

    email: z.email("Not email !!"),

    // =====================================================
    // INTERNATIONAL PHONE NUMBER VALIDATION
    // Supports all countries supported by libphonenumber-js
    // Phone is optional
    // Country code is required (E.164)
    // =====================================================

    phone: z
      .string()
      .trim()
      .refine(
        (value) => {
          const parsedPhone = parsePhoneNumberFromString(value);

          return parsedPhone?.isValid() === true;
        },
        {
          message:
            "Invalid international phone number. Please include a valid country code (e.g. +85291234567)",
        },
      )
      .transform((value) => {
        const parsedPhone = parsePhoneNumberFromString(value);

        return parsedPhone!.number;
      })
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
      )
      .refine(isWithinBcryptPasswordLimit, {
        message: "Password must not exceed 72 UTF-8 bytes",
      }),
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
    brandId: z.uuid().optional(),
  }),
});

const verifyResetOtpValidationSchema = z.object({
  body: z.object({
    email: z.email("Invalid email address"),
    brandId: z.uuid().optional(),

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
      )
      .refine(isWithinBcryptPasswordLimit, {
        message: "Password must not exceed 72 UTF-8 bytes",
      }),
  }),
});

const verifyEmailOtpValidationSchema = z.object({
  body: z.object({
    email: z.email("Invalid email address").trim().toLowerCase(),

    otp: z.string().regex(/^\d{6}$/, "OTP must be exactly 6 digits"),
  }),
});

const resendVerificationOtpValidationSchema = z.object({
  body: z.object({
    email: z.string().trim().toLowerCase().email("Invalid email address"),
  }),
});

export const authValidation = {
  registerValidationSchema,
  LoginZodSchema,
  forgotPasswordValidationSchema,
  verifyResetOtpValidationSchema,
  resetPasswordValidationSchema,
  verifyEmailOtpValidationSchema,
  resendVerificationOtpValidationSchema,
};
