import { z } from "zod";

const brandLocaleSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, "Brand name must be at least 2 characters")
      .max(100, "Brand name must not exceed 100 characters")
      .optional(),

    description: z
      .string()
      .trim()
      .max(1000, "Description must not exceed 1000 characters")
      .optional(),
  })
  .strict();

const brandTranslationsSchema = z
  .object({
    en: brandLocaleSchema.optional(),
    "zh-CN": brandLocaleSchema.optional(),
    "zh-HK": brandLocaleSchema.optional(),
  })
  .strict();

const updateBrandValidationSchema = z.object({
  body: z.object({
    name: z
      .string()
      .trim()
      .min(2, "Brand name must be at least 2 characters")
      .max(100, "Brand name must not exceed 100 characters")
      .optional(),

    description: z
      .string()
      .trim()
      .max(1000, "Description must not exceed 1000 characters")
      .optional(),

    phone: z
      .string()
      .trim()
      .regex(/^\+852\d{8}$/, "Phone must be a valid Hong Kong number")
      .optional(),

    email: z.string().trim().email("Invalid email address").optional(),

    logoObjectKey: z
      .string()
      .trim()
      .min(1, "Invalid logo object key")
      .optional(),

    translations: brandTranslationsSchema.optional(),
  }),
});

export const brandValidation = {
  updateBrandValidationSchema,
};
