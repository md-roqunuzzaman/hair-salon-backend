import { z } from "zod";

const updateBrandValidationSchema = z.object({
  body: z.object({
    name: z
      .string()
      .min(2, "Brand name must be at least 2 characters")
      .max(100, "Brand name must not exceed 100 characters")
      .optional(),

    description: z
      .string()
      .max(1000, "Description must not exceed 1000 characters")
      .optional(),

    phone: z
      .string()
      .regex(/^\+852\d{8}$/, "Phone must be a valid Hong Kong number")
      .optional(),

    email: z.email("Invalid email address").optional(),

    logoObjectKey: z.string().optional(),
  }),
});

export const brandValidation = {
  updateBrandValidationSchema,
};
