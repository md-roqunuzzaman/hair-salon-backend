import { z } from "zod";

// =====================================================
// CREATE BANNER VALIDATION
// =====================================================

const createBannerValidationSchema = z.object({
  body: z
    .object({
      title: z
        .string()
        .trim()
        .min(1, "Banner title is required")
        .max(150, "Banner title must not exceed 150 characters"),

      description: z
        .string()
        .trim()
        .max(2000, "Description must not exceed 2000 characters")
        .nullable()
        .optional(),

      scope: z
        .enum(["BRAND_WIDE", "SELECTED_BRANCHES"])
        .default("SELECTED_BRANCHES"),

      branchIds: z
        .array(z.string().uuid("Invalid branch ID"))
        .max(100, "Maximum 100 branches are allowed")
        .default([]),

      status: z.enum(["DRAFT", "ACTIVE", "INACTIVE"]).default("DRAFT"),

      startAt: z.iso.datetime({ offset: true }).nullable().optional(),

      endAt: z.iso.datetime({ offset: true }).nullable().optional(),

      sortOrder: z
        .number()
        .int("Sort order must be an integer")
        .min(0, "Sort order cannot be negative")
        .default(0),
    })
    .superRefine((data, ctx) => {
      // BRAND_WIDE does not require branch assignments.
      if (data.scope === "BRAND_WIDE" && data.branchIds.length > 0) {
        ctx.addIssue({
          code: "custom",
          path: ["branchIds"],
          message: "Brand-wide banners cannot have selected branches",
        });
      }

      // SELECTED_BRANCHES requires at least one branch.
      if (data.scope === "SELECTED_BRANCHES" && data.branchIds.length === 0) {
        ctx.addIssue({
          code: "custom",
          path: ["branchIds"],
          message: "Select at least one branch",
        });
      }

      // Prevent duplicate branch assignments.
      if (new Set(data.branchIds).size !== data.branchIds.length) {
        ctx.addIssue({
          code: "custom",
          path: ["branchIds"],
          message: "Duplicate branch IDs are not allowed",
        });
      }

      // Validate scheduling dates.
      if (data.startAt && data.endAt) {
        if (
          new Date(data.endAt).getTime() <= new Date(data.startAt).getTime()
        ) {
          ctx.addIssue({
            code: "custom",
            path: ["endAt"],
            message: "End date must be later than start date",
          });
        }
      }
    }),
});

// =====================================================
// EXPORT
// =====================================================

// =====================================================
// API 02 — ATTACH BANNER MEDIA VALIDATION
// POST /api/v1/banners/:bannerId/media
// =====================================================

const attachBannerMediaValidationSchema = z.object({
  params: z.object({
    bannerId: z.string().uuid("Invalid banner ID"),
  }),

  body: z
    .object({
      objectKey: z
        .string()
        .trim()
        .min(1, "Object key is required")
        .max(1024, "Object key is too long")
        .regex(
          /^banners\/[0-9a-fA-F-]{36}\/[0-9a-fA-F-]{36}\.(jpg|mp4)$/,
          "Invalid banner media object key",
        ),

      mediaType: z.enum(["IMAGE", "VIDEO"]),

      sortOrder: z
        .number()
        .int("Sort order must be an integer")
        .min(0, "Sort order cannot be negative")
        .default(0),
    })
    .superRefine((data, ctx) => {
      const isImage = data.objectKey.endsWith(".jpg");
      const isVideo = data.objectKey.endsWith(".mp4");

      if (data.mediaType === "IMAGE" && !isImage) {
        ctx.addIssue({
          code: "custom",
          path: ["mediaType"],
          message: "IMAGE media must use a .jpg object key",
        });
      }

      if (data.mediaType === "VIDEO" && !isVideo) {
        ctx.addIssue({
          code: "custom",
          path: ["mediaType"],
          message: "VIDEO media must use a .mp4 object key",
        });
      }
    }),
});

const updateBannerStatusValidationSchema = z.object({
  params: z.object({
    bannerId: z.uuid("Invalid banner ID"),
  }),

  body: z
    .object({
      status: z.enum(["DRAFT", "ACTIVE", "INACTIVE"]),
    })
    .strict(),
});

const getBannerDetailsValidationSchema = z.object({
  params: z.object({
    bannerId: z.uuid("Invalid banner ID"),
  }),
});

const getAdminBannersValidationSchema = z.object({
  query: z
    .object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(10),

      search: z.string().trim().max(150).optional(),

      status: z.enum(["DRAFT", "ACTIVE", "INACTIVE"]).optional(),

      scope: z.enum(["BRAND_WIDE", "SELECTED_BRANCHES"]).optional(),

      branchId: z.uuid("Invalid branch ID").optional(),

      sortBy: z
        .enum(["createdAt", "updatedAt", "sortOrder", "startAt", "endAt"])
        .default("createdAt"),

      sortOrder: z.enum(["asc", "desc"]).default("desc"),
    })
    .strict(),
});

const updateBannerValidationSchema = z.object({
  params: z.object({
    bannerId: z.uuid("Invalid banner ID"),
  }),

  body: z
    .object({
      title: z.string().trim().min(1).max(150).optional(),

      description: z.string().trim().max(2000).nullable().optional(),

      scope: z.enum(["BRAND_WIDE", "SELECTED_BRANCHES"]).optional(),

      branchIds: z.array(z.uuid()).optional(),

      startAt: z.iso.datetime({ offset: true }).nullable().optional(),

      endAt: z.iso.datetime({ offset: true }).nullable().optional(),

      sortOrder: z.number().int().min(0).optional(),
    })
    .strict()
    .refine(
      (data) => Object.keys(data).length > 0,
      "At least one field is required",
    )
    .refine(
      (data) =>
        !data.branchIds ||
        new Set(data.branchIds).size === data.branchIds.length,
      {
        message: "Duplicate branch IDs are not allowed",
        path: ["branchIds"],
      },
    )
    .refine(
      (data) =>
        data.scope !== "BRAND_WIDE" ||
        !data.branchIds ||
        data.branchIds.length === 0,
      {
        message: "BRAND_WIDE banners cannot have selected branches",
        path: ["branchIds"],
      },
    ),
});

// =====================================================
// API 07 — REMOVE BANNER MEDIA VALIDATION
// =====================================================

const removeBannerMediaValidationSchema = z.object({
  params: z.object({
    bannerId: z.uuid("Invalid banner ID"),
    mediaId: z.uuid("Invalid media ID"),
  }),
});

// =====================================================
// API 08 — DELETE BANNER VALIDATION
// =====================================================

const deleteBannerValidationSchema = z.object({
  params: z.object({
    bannerId: z.uuid("Invalid banner ID"),
  }),
});

// =====================================================
// API 09 — CUSTOMER ACTIVE BANNERS VALIDATION
// =====================================================

const getActiveBannersValidationSchema = z.object({
  query: z
    .object({
      branchId: z.uuid("Invalid branch ID"),

      page: z.coerce.number().int().min(1).default(1),

      limit: z.coerce.number().int().min(1).max(50).default(10),
    })
    .strict(),
});

// =====================================================
// API 10 — UPDATE BANNER MEDIA ORDER VALIDATION
// =====================================================

const updateBannerMediaOrderValidationSchema = z.object({
  params: z.object({
    bannerId: z.uuid("Invalid banner ID"),
  }),

  body: z
    .object({
      mediaIds: z
        .array(z.uuid("Invalid media ID"))
        .min(1, "At least one media ID is required")
        .refine(
          (ids) => new Set(ids).size === ids.length,
          "Duplicate media IDs are not allowed",
        ),
    })
    .strict(),
});

const updateBannerCarouselSettingsValidationSchema = z.object({
  params: z.object({
    branchId: z.uuid(),
  }),
  body: z
    .object({
      imageIntervalMs: z.number().int().min(1000).max(120000).optional(),
      videoIntervalMs: z.number().int().min(1000).max(120000).optional(),
    })
    .strict()
    .refine(
      (data) =>
        data.imageIntervalMs !== undefined ||
        data.videoIntervalMs !== undefined,
      {
        message: "At least one carousel interval is required",
      },
    ),
});
export const bannerValidation = {
  createBannerValidationSchema,
  attachBannerMediaValidationSchema,
  updateBannerStatusValidationSchema,
  getBannerDetailsValidationSchema,
  getAdminBannersValidationSchema,
  updateBannerValidationSchema,
  removeBannerMediaValidationSchema,
  deleteBannerValidationSchema,
  getActiveBannersValidationSchema,
  updateBannerMediaOrderValidationSchema,
  updateBannerCarouselSettingsValidationSchema,
};
