import { z } from "zod";

const createBranchValidationSchema = z.object({
  body: z.object({
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
  }),
});

const updateBranchValidationSchema = z.object({
  body: z.object({
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
  }),
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
  body: z.object({
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

    cancellationCutoffHours: z
      .number()
      .int()
      .min(0, "Cancellation cutoff cannot be negative"),

    rescheduleCutoffHours: z
      .number()
      .int()
      .min(0, "Reschedule cutoff cannot be negative"),

    reserveExpiryRule: z.enum(["APPOINTMENT_TIME"]),
  }),
});
export const branchValidation = {
  createBranchValidationSchema,
  updateBranchValidationSchema,
  updateBranchStatusValidationSchema,
  businessHourSchema,
  updateBusinessHoursValidationSchema,
  updateBookingPolicyValidationSchema,
};
