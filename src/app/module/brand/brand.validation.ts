import { z } from "zod";

// =====================================================
// BRAND LOCALE
// =====================================================

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

// =====================================================
// BRAND TRANSLATIONS
// =====================================================

const brandTranslationsSchema = z
  .object({
    en: brandLocaleSchema.optional(),
    "zh-CN": brandLocaleSchema.optional(),
    "zh-HK": brandLocaleSchema.optional(),
  })
  .strict();

// =====================================================
// UPDATE BRAND
// =====================================================

const updateBrandValidationSchema = z.object({
  body: z
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

      // International E.164 phone format
      // Examples: +85212345678, +447911123456
      phone: z
        .string()
        .trim()
        .regex(
          /^\+[1-9]\d{1,14}$/,
          "Phone must be a valid international number",
        )
        .optional(),

      email: z.string().trim().email("Invalid email address").optional(),

      logoObjectKey: z
        .string()
        .trim()
        .min(1, "Invalid logo object key")
        .optional(),

      translations: brandTranslationsSchema.optional(),
    })
    .strict(),
});

// =====================================================
// BRAND THEME
// =====================================================

const hexColorSchema = z
  .string()
  .regex(/^#[0-9A-Fa-f]{6}$/, "Color must be a valid HEX value (#RRGGBB)");

const updateBrandThemeValidationSchema = z.object({
  body: z
    .object({
      primaryColor: hexColorSchema.optional(),
      secondaryColor: hexColorSchema.optional(),
      backgroundColor: hexColorSchema.optional(),
      surfaceColor: hexColorSchema.optional(),
      textColor: hexColorSchema.optional(),
      mutedTextColor: hexColorSchema.optional(),
      lineColor: hexColorSchema.optional(),
      onPrimaryColor: hexColorSchema.optional(),
    })
    .strict()
    .refine(
      (data) => Object.keys(data).length > 0,
      "At least one theme color must be provided",
    ),
});

const updateBrandInternationalSettingsValidationSchema = z.object({
  body: z
    .object({
      countryCode: z
        .string()
        .trim()
        .regex(/^[A-Za-z]{2}$/, "Country code must contain 2 letters")
        .transform((value) => value.toUpperCase())
        .optional(),

      currency: z
        .string()
        .trim()
        .regex(/^[A-Za-z]{3}$/, "Currency code must contain 3 letters")
        .transform((value) => value.toUpperCase())
        .optional(),

      timezone: z
        .string()
        .trim()
        .min(1, "Timezone is required")
        .max(100, "Timezone is too long")
        .optional(),
    })
    .strict()
    .refine((data) => Object.keys(data).length > 0, {
      message: "At least one international setting must be provided",
    }),
});

export const brandValidation = {
  updateBrandValidationSchema,
  updateBrandThemeValidationSchema,
  updateBrandInternationalSettingsValidationSchema,
};
