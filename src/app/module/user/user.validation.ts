import { z } from "zod";
import { isWithinBcryptPasswordLimit } from "../../utils/password-security.js";
import parsePhoneNumberFromString from "libphonenumber-js";

const updateProfileValidationSchema = z.object({
  body: z
    .object({
      name: z
        .string()
        .trim()
        .min(3, "Name must be at least 3 characters long")
        .max(50, "Name must not exceed 50 characters")
        .optional(),

      // =====================================================
      // INTERNATIONAL PHONE NUMBER VALIDATION
      // =====================================================

      phone: z
        .string()
        .trim()
        .refine(
          (value) => {
            if (!value.startsWith("+")) return false;

            const parsedPhone = parsePhoneNumberFromString(value);

            return parsedPhone?.isValid() === true;
          },
          {
            message:
              "Invalid international phone number. Include country code (e.g. +85291234567)",
          },
        )
        .transform((value) => {
          const parsedPhone = parsePhoneNumberFromString(value);

          return parsedPhone!.number;
        })
        .optional(),

      avatarObjectKey: z
        .string()
        .trim()
        .min(1, "Invalid avatar object key")
        .optional(),
    })
    .refine(
      (data) =>
        data.name !== undefined ||
        data.phone !== undefined ||
        data.avatarObjectKey !== undefined,
      {
        message: "Provide a name, phone number, or avatar to update",
      },
    ),
});

const changePasswordValidationSchema = z.object({
  body: z.object({
    currentPassword: z.string().min(1, "Current password is required"),

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

export const userValidation = {
  updateProfileValidationSchema,
  changePasswordValidationSchema,
};
