import { z } from "zod";

const updateProfileValidationSchema = z.object({
  body: z.object({
    name: z
      .string()
      .trim()
      .min(3, "Name must be at least 3 characters long")
      .max(50, "Name must not exceed 50 characters")
      .optional(),

    phone: z
      .string()
      .trim()
      .min(8, "Phone number must be at least 8 characters")
      .max(20, "Phone number must not exceed 20 characters")
      .optional(),
  }).refine((data) => data.name !== undefined || data.phone !== undefined, {
    message: "Provide a name or phone number to update",
  }),
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
      ),
  }),
});

export const userValidation = {
  updateProfileValidationSchema,
  changePasswordValidationSchema,
};
