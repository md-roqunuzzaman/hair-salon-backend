import { z } from "zod";

const branchLocaleSchema = z
  .object({
    name: z.string().trim().min(2).max(100).optional(),

    address: z.string().trim().min(3).max(255).optional(),

    description: z.string().trim().max(1000).optional(),
  })
  .strict();

const branchTranslationsSchema = z
  .object({
    en: branchLocaleSchema.optional(),
    "zh-CN": branchLocaleSchema.optional(),
    "zh-HK": branchLocaleSchema.optional(),
  })
  .strict();

const createBranchValidationSchema = z.object({
  body: z
    .object({
      name: z
        .string()
        .min(2, "Branch name must be at least 2 characters")
        .max(100, "Branch name must not exceed 100 characters"),

      address: z
        .string()
        .min(3, "Address is required")
        .max(255, "Address must not exceed 255 characters"),

      phone: z
        .string()
        .regex(/^\+852\d{8}$/, "Phone must be a valid Hong Kong number")
        .optional(),

      description: z
        .string()
        .max(1000, "Description must not exceed 1000 characters")
        .optional(),

      imageObjectKey: z.string().optional(),

      translations: branchTranslationsSchema.optional(),

      latitude: z
        .number()
        .finite()
        .min(-90, "Latitude must be at least -90")
        .max(90, "Latitude must not exceed 90")
        .optional(),

      longitude: z
        .number()
        .finite()
        .min(-180, "Longitude must be at least -180")
        .max(180, "Longitude must not exceed 180")
        .optional(),
    })
    .refine(
      (data) =>
        (data.latitude === undefined) === (data.longitude === undefined),
      {
        message: "Latitude and longitude must be provided together",
        path: ["latitude"],
      },
    ),
});

const updateBranchValidationSchema = z.object({
  body: z
    .object({
      name: z
        .string()
        .min(2, "Branch name must be at least 2 characters")
        .max(100, "Branch name must not exceed 100 characters")
        .optional(),

      address: z
        .string()
        .min(3, "Address is required")
        .max(255, "Address must not exceed 255 characters")
        .optional(),

      phone: z
        .string()
        .regex(/^\+852\d{8}$/, "Phone must be a valid Hong Kong number")
        .optional(),

      description: z
        .string()
        .max(1000, "Description must not exceed 1000 characters")
        .optional(),

      imageObjectKey: z.string().optional(),

      translations: branchTranslationsSchema.optional(),

      latitude: z
        .number()
        .finite()
        .min(-90, "Latitude must be at least -90")
        .max(90, "Latitude must not exceed 90")
        .optional(),

      longitude: z
        .number()
        .finite()
        .min(-180, "Longitude must be at least -180")
        .max(180, "Longitude must not exceed 180")
        .optional(),
    })
    .refine(
      (data) =>
        (data.latitude === undefined) === (data.longitude === undefined),
      {
        message: "Latitude and longitude must be provided together",
        path: ["latitude"],
      },
    ),
});

const updateBranchStatusValidationSchema = z.object({
  body: z.object({
    status: z.enum(["ACTIVE", "INACTIVE"]),
  }),
});

const businessHourSchema = z
  .object({
    day: z.enum([
      "MONDAY",
      "TUESDAY",
      "WEDNESDAY",
      "THURSDAY",
      "FRIDAY",
      "SATURDAY",
      "SUNDAY",
    ]),

    isClosed: z.boolean(),

    openTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Open time must be in HH:mm format")
      .nullable()
      .optional(),

    closeTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Close time must be in HH:mm format")
      .nullable()
      .optional(),
  })
  .superRefine((data, ctx) => {
    if (data.isClosed) {
      if (data.openTime !== null && data.openTime !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["openTime"],
          message: "Open time must be null when branch is closed",
        });
      }

      if (data.closeTime !== null && data.closeTime !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["closeTime"],
          message: "Close time must be null when branch is closed",
        });
      }

      return;
    }

    if (!data.openTime) {
      ctx.addIssue({
        code: "custom",
        path: ["openTime"],
        message: "Open time is required when branch is open",
      });
    }

    if (!data.closeTime) {
      ctx.addIssue({
        code: "custom",
        path: ["closeTime"],
        message: "Close time is required when branch is open",
      });
    }

    if (data.openTime && data.closeTime && data.openTime >= data.closeTime) {
      ctx.addIssue({
        code: "custom",
        path: ["closeTime"],
        message: "Close time must be later than open time",
      });
    }
  });

const updateBusinessHoursValidationSchema = z.object({
  body: z.object({
    hours: z
      .array(businessHourSchema)
      .min(1, "At least one business hour is required")
      .max(7, "Maximum 7 days are allowed"),
  }),
});

const updateBookingPolicyValidationSchema = z.object({
  body: z
    .object({
      slotIntervalMinutes: z
        .number()
        .int()
        .positive("Slot interval must be greater than 0"),

      minimumBookingNoticeMinutes: z
        .number()
        .int()
        .min(0, "Minimum booking notice cannot be negative"),

      maximumAdvanceBookingDays: z
        .number()
        .int()
        .positive("Maximum advance booking days must be greater than 0"),

      cancellationCutoffMinutes: z
        .number()
        .int()
        .min(0, "Cancellation cutoff cannot be negative"),

      rescheduleCutoffMinutes: z
        .number()
        .int()
        .min(0, "Reschedule cutoff cannot be negative"),

      reserveExpiryRule: z.enum(["APPOINTMENT_TIME"]),

      // NEW
      qrVerificationRule: z.enum(["BEFORE_START_TIME", "BEFORE_END_TIME"]),

      allowedBookingMethods: z
        .array(z.enum(["PAY_NOW", "DEPOSIT", "RESERVE_NOW"]))
        .min(1, "At least one booking method must be enabled")
        .max(3, "Maximum three booking methods are allowed")
        .refine(
          (methods) => new Set(methods).size === methods.length,
          "Duplicate booking methods are not allowed",
        ),

      depositPercentage: z
        .number()
        .min(1, "Deposit percentage must be at least 1")
        .max(100, "Deposit percentage cannot exceed 100"),
    })
    .strict(),
});
const customerOperationalSearchValidationSchema = z.object({
  body: z.object({
    q: z.string().trim().min(1, "Search query is required").max(100),
  }),
});

const getBranchDailySummaryValidationSchema = z.object({
  body: z.object({
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be in YYYY-MM-DD format")
      .refine((value) => {
        const parsedDate = new Date(`${value}T00:00:00.000Z`);

        return (
          !Number.isNaN(parsedDate.getTime()) &&
          parsedDate.toISOString().slice(0, 10) === value
        );
      }, "Invalid date"),
  }),
});

const getBranchDailySeriesValidationSchema = z.object({
  body: z
    .object({
      start: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "start must be in YYYY-MM-DD format")
        .refine((value) => {
          const parsed = new Date(`${value}T00:00:00.000Z`);

          return (
            !Number.isNaN(parsed.getTime()) &&
            parsed.toISOString().slice(0, 10) === value
          );
        }, "Invalid start date"),

      end: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "end must be in YYYY-MM-DD format")
        .refine((value) => {
          const parsed = new Date(`${value}T00:00:00.000Z`);

          return (
            !Number.isNaN(parsed.getTime()) &&
            parsed.toISOString().slice(0, 10) === value
          );
        }, "Invalid end date"),
    })
    .superRefine((data, ctx) => {
      const startDate = new Date(`${data.start}T00:00:00.000Z`);
      const endDate = new Date(`${data.end}T00:00:00.000Z`);

      if (
        Number.isNaN(startDate.getTime()) ||
        Number.isNaN(endDate.getTime())
      ) {
        return;
      }

      if (startDate > endDate) {
        ctx.addIssue({
          code: "custom",
          path: ["end"],
          message: "end date must be greater than or equal to start date",
        });

        return;
      }

      const totalDays =
        Math.round(
          (endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000),
        ) + 1;

      if (totalDays > 366) {
        ctx.addIssue({
          code: "custom",
          path: ["end"],
          message: "Date range cannot exceed 366 days",
        });
      }
    }),
});

const getBranchStaffOutputValidationSchema = z.object({
  body: z
    .object({
      start: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "start must be in YYYY-MM-DD format")
        .refine((value) => {
          const parsed = new Date(`${value}T00:00:00.000Z`);

          return (
            !Number.isNaN(parsed.getTime()) &&
            parsed.toISOString().slice(0, 10) === value
          );
        }, "Invalid start date"),

      end: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "end must be in YYYY-MM-DD format")
        .refine((value) => {
          const parsed = new Date(`${value}T00:00:00.000Z`);

          return (
            !Number.isNaN(parsed.getTime()) &&
            parsed.toISOString().slice(0, 10) === value
          );
        }, "Invalid end date"),
    })
    .superRefine((data, ctx) => {
      const startDate = new Date(`${data.start}T00:00:00.000Z`);
      const endDate = new Date(`${data.end}T00:00:00.000Z`);

      if (
        Number.isNaN(startDate.getTime()) ||
        Number.isNaN(endDate.getTime())
      ) {
        return;
      }

      if (startDate > endDate) {
        ctx.addIssue({
          code: "custom",
          path: ["end"],
          message: "end date must be greater than or equal to start date",
        });

        return;
      }

      const totalDays =
        Math.round(
          (endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000),
        ) + 1;

      if (totalDays > 366) {
        ctx.addIssue({
          code: "custom",
          path: ["end"],
          message: "Date range cannot exceed 366 days",
        });
      }
    }),
});

const getNearbyBranchesValidationSchema = z.object({
  body: z.object({
    latitude: z.coerce
      .number()
      .finite()
      .min(-90, "Latitude must be at least -90")
      .max(90, "Latitude must not exceed 90"),

    longitude: z.coerce
      .number()
      .finite()
      .min(-180, "Longitude must be at least -180")
      .max(180, "Longitude must not exceed 180"),

    radiusKm: z.coerce
      .number()
      .finite()
      .positive("radiusKm must be greater than 0")
      .max(100, "radiusKm cannot exceed 100")
      .default(10),

    page: z.coerce.number().int().min(1, "Page must be at least 1").default(1),

    limit: z.coerce
      .number()
      .int()
      .min(1, "Limit must be at least 1")
      .max(100, "Limit cannot exceed 100")
      .default(20),
  }),
});

// =====================================================
// UPDATE BRANCH CANCELLATION POLICY VALIDATION
// =====================================================

// =====================================================
// BRANCH CANCELLATION POLICY - REFUND TIER VALIDATION
// =====================================================

const refundTierValidationSchema = z
  .object({
    minimumMinutesBefore: z.number().int().min(0),

    calculationType: z.enum(["PERCENTAGE", "FIXED"]),

    value: z.number().finite().nonnegative(),
  })
  .strict()
  .superRefine((tier, ctx) => {
    if (tier.calculationType === "PERCENTAGE" && tier.value > 100) {
      ctx.addIssue({
        code: "custom",
        path: ["value"],
        message: "Refund percentage cannot exceed 100",
      });
    }

    if (
      tier.calculationType === "FIXED" &&
      Math.round(tier.value * 100) / 100 !== tier.value
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["value"],
        message: "Fixed refund amount supports at most two decimal places",
      });
    }
  });

// =====================================================
// UPDATE BRANCH CANCELLATION POLICY VALIDATION
// =====================================================

const updateCancellationPolicyValidationSchema = z.object({
  body: z
    .object({
      isEnabled: z.boolean(),

      cancellationAllowed: z.boolean(),

      minimumCancellationMinutes: z.number().int().min(0),

      nonRefundable: z.boolean(),

      refundTiers: z.array(refundTierValidationSchema).min(1),
    })
    .strict()
    .superRefine((policy, ctx) => {
      const hours = new Set<number>();

      for (const [index, tier] of policy.refundTiers.entries()) {
        // Duplicate tier check
        if (hours.has(tier.minimumMinutesBefore)) {
          ctx.addIssue({
            code: "custom",
            path: ["refundTiers", index, "minimumMinutesBefore"],
            message: "Duplicate refund tier minimum minutes",
          });
        }

        hours.add(tier.minimumMinutesBefore);

        // Tier must not be below minimum cancellation notice
        if (tier.minimumMinutesBefore < policy.minimumCancellationMinutes) {
          ctx.addIssue({
            code: "custom",
            path: ["refundTiers", index, "minimumMinutesBefore"],
            message: "Refund tier cannot be below minimum cancellation minutes",
          });
        }
      }

      // Ensure cancellation window has a matching refund tier
      if (!hours.has(policy.minimumCancellationMinutes)) {
        ctx.addIssue({
          code: "custom",
          path: ["refundTiers"],
          message: "Refund tiers must cover the minimum cancellation notice",
        });
      }
    }),
});

export const branchValidation = {
  createBranchValidationSchema,
  updateBranchValidationSchema,
  updateBranchStatusValidationSchema,
  businessHourSchema,
  updateBusinessHoursValidationSchema,
  updateBookingPolicyValidationSchema,
  customerOperationalSearchValidationSchema,
  getBranchDailySummaryValidationSchema,
  getBranchDailySeriesValidationSchema,
  getBranchStaffOutputValidationSchema,
  getNearbyBranchesValidationSchema,
  updateCancellationPolicyValidationSchema,
};
