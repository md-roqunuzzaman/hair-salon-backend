import { z } from "zod";

// =====================================================
// PROMOTION TRANSLATIONS
// =====================================================

const promotionTranslationsSchema = z
  .object({
    en: z
      .object({
        name: z.string().trim().min(1).max(150),
      })
      .strict()
      .optional(),

    "zh-CN": z
      .object({
        name: z.string().trim().min(1).max(150),
      })
      .strict()
      .optional(),

    "zh-HK": z
      .object({
        name: z.string().trim().min(1).max(150),
      })
      .strict()
      .optional(),
  })
  .strict();

// =====================================================
// CREATE PROMOTION
// =====================================================

const createPromotionValidationSchema = z.object({
  body: z
    .object({
      name: z.string().trim().min(1, "Promotion name is required").max(150),

      translations: promotionTranslationsSchema.optional(),

      minimumTopup: z.number().positive("minimumTopup must be greater than 0"),

      bonusAmount: z.number().positive("bonusAmount must be greater than 0"),

      startAt: z.string().datetime({ offset: true }),

      endAt: z.string().datetime({ offset: true }),

      branchIds: z.array(z.string().uuid()).default([]),

      serviceIds: z.array(z.string().uuid()).default([]),

      packageIds: z.array(z.string().uuid()).default([]),

      status: z.enum(["ACTIVE", "INACTIVE"]),

      imageObjectKey: z
        .string()
        .trim()
        .min(1, "Invalid promotion image object key")
        .optional(),
    })
    .superRefine((data, ctx) => {
      const startAt = new Date(data.startAt);
      const endAt = new Date(data.endAt);

      if (startAt.getTime() >= endAt.getTime()) {
        ctx.addIssue({
          code: "custom",
          path: ["endAt"],
          message: "endAt must be after startAt",
        });
      }

      if (new Set(data.branchIds).size !== data.branchIds.length) {
        ctx.addIssue({
          code: "custom",
          path: ["branchIds"],
          message: "branchIds must not contain duplicates",
        });
      }

      if (new Set(data.serviceIds).size !== data.serviceIds.length) {
        ctx.addIssue({
          code: "custom",
          path: ["serviceIds"],
          message: "serviceIds must not contain duplicates",
        });
      }

      if (new Set(data.packageIds).size !== data.packageIds.length) {
        ctx.addIssue({
          code: "custom",
          path: ["packageIds"],
          message: "packageIds must not contain duplicates",
        });
      }
    }),
});

// =====================================================
// GET PROMOTIONS QUERY
// =====================================================

const getPromotionsQueryValidationSchema = z.object({
  branchId: z.string().uuid().optional(),
});

// =====================================================
// UPDATE PROMOTION
// =====================================================

const updatePromotionValidationSchema = z.object({
  body: z
    .object({
      name: z
        .string()
        .trim()
        .min(1, "Promotion name is required")
        .max(150)
        .optional(),

      // FIX: TRANSLATIONS BELONG HERE
      translations: promotionTranslationsSchema.optional(),

      minimumTopup: z
        .number()
        .positive("minimumTopup must be greater than 0")
        .optional(),

      bonusAmount: z
        .number()
        .positive("bonusAmount must be greater than 0")
        .optional(),

      startAt: z.string().datetime({ offset: true }).optional(),

      endAt: z.string().datetime({ offset: true }).optional(),

      branchIds: z.array(z.string().uuid()).optional(),

      serviceIds: z.array(z.string().uuid()).optional(),

      packageIds: z.array(z.string().uuid()).optional(),

      imageObjectKey: z
        .string()
        .trim()
        .min(1, "Invalid promotion image object key")
        .optional(),
    })
    .refine((data) => Object.keys(data).length > 0, {
      message: "At least one field is required",
    })
    .superRefine((data, ctx) => {
      if (
        data.startAt &&
        data.endAt &&
        new Date(data.startAt) >= new Date(data.endAt)
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["endAt"],
          message: "endAt must be after startAt",
        });
      }

      if (
        data.branchIds &&
        new Set(data.branchIds).size !== data.branchIds.length
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["branchIds"],
          message: "branchIds must not contain duplicates",
        });
      }

      if (
        data.serviceIds &&
        new Set(data.serviceIds).size !== data.serviceIds.length
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["serviceIds"],
          message: "serviceIds must not contain duplicates",
        });
      }

      if (
        data.packageIds &&
        new Set(data.packageIds).size !== data.packageIds.length
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["packageIds"],
          message: "packageIds must not contain duplicates",
        });
      }
    }),
});

// =====================================================
// UPDATE PROMOTION STATUS
// =====================================================

const updatePromotionStatusValidationSchema = z.object({
  body: z.object({
    status: z.enum(["ACTIVE", "INACTIVE"]),
  }),
});

// =====================================================
// EXPORT
// =====================================================

export const promotionValidation = {
  createPromotionValidationSchema,
  updatePromotionValidationSchema,
  updatePromotionStatusValidationSchema,
  getPromotionsQueryValidationSchema,
};
