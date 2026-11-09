import { z } from "zod";

// =====================================================
// SERVICE TRANSLATION VALIDATION
// =====================================================

const serviceLocaleSchema = z
  .object({
    name: z.string().trim().min(2).max(100).optional(),

    description: z.string().trim().max(1000).nullable().optional(),

    processSteps: z.array(z.string().trim().min(1)).optional(),

    bookingNotes: z.array(z.string().trim().min(1)).optional(),
  })
  .strict();

const serviceTranslationsSchema = z
  .object({
    en: serviceLocaleSchema.optional(),
    "zh-CN": serviceLocaleSchema.optional(),
    "zh-HK": serviceLocaleSchema.optional(),
  })
  .strict();

// =====================================================
// SERVICE DISPLAY FIELD VALIDATION
// =====================================================

const serviceDisplayFieldsSchema = {
  isPopular: z.boolean().optional(),

  processSteps: z
    .array(z.string().trim().min(1, "Process step cannot be empty"))
    .optional(),

  bookingNotes: z
    .array(z.string().trim().min(1, "Booking note cannot be empty"))
    .optional(),
};

// =====================================================
// CREATE SERVICE
// =====================================================

const createServiceValidationSchema = z.object({
  body: z.object({
    name: z
      .string()
      .min(2, "Service name must be at least 2 characters")
      .max(100, "Service name must not exceed 100 characters"),

    description: z
      .string()
      .max(1000, "Description must not exceed 1000 characters")
      .optional(),

    price: z.number().positive("Price must be greater than 0"),

    durationMinutes: z
      .number()
      .int()
      .positive("Duration must be greater than 0"),

    branchIds: z
      .array(z.string().uuid("Invalid branch ID"))
      .min(1, "At least one branch is required"),
    staffIds: z.array(z.string().uuid("Invalid staff ID")).optional(),

    imageObjectKeys: z
      .array(z.string().min(1, "Invalid image object key"))
      .min(1, "At least one service image is required")
      .optional(),

    // SERVICE DISPLAY FIELDS
    ...serviceDisplayFieldsSchema,

    // MULTILINGUAL SUPPORT
    translations: serviceTranslationsSchema.optional(),
  }),
});

// =====================================================
// UPDATE SERVICE
// =====================================================

const updateServiceValidationSchema = z.object({
  body: z.object({
    name: z.string().min(2).max(100).optional(),

    description: z.string().max(1000).optional(),

    price: z.number().positive().optional(),

    imageObjectKeys: z.array(z.string().trim().min(1)).optional(),

    durationMinutes: z.number().int().positive().optional(),

    // SERVICE DISPLAY FIELDS
    ...serviceDisplayFieldsSchema,

    // MULTILINGUAL SUPPORT
    translations: serviceTranslationsSchema.optional(),
  }),
});

// =====================================================
// UPDATE SERVICE STATUS
// =====================================================

const updateServiceStatusValidationSchema = z.object({
  body: z.object({
    status: z.enum(["ACTIVE", "INACTIVE"]),
  }),
});

// =====================================================
// ASSIGN SERVICE BRANCHES
// =====================================================

const assignServiceBranchesValidationSchema = z.object({
  body: z.object({
    branchIds: z
      .array(z.string().uuid("Invalid branch ID"))
      .min(1, "At least one branch is required"),
  }),
});

// =====================================================
// SERVICE BOOKING SCHEDULE VALIDATION
// =====================================================

const serviceBookingDaySchema = z.enum([
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
]);

// =====================================================
// TIME FORMAT VALIDATION (HH:mm)
// =====================================================

const serviceBookingTimeSchema = z
  .string()
  .regex(
    /^([01]\d|2[0-3]):[0-5]\d$/,
    "Time must be in HH:mm format (00:00-23:59)",
  );

// =====================================================
// SINGLE BOOKING WINDOW VALIDATION
// =====================================================

const serviceBookingWindowSchema = z
  .object({
    day: serviceBookingDaySchema,

    startTime: serviceBookingTimeSchema,

    endTime: serviceBookingTimeSchema,
  })
  .strict()
  .refine((window) => window.startTime < window.endTime, {
    message: "Start time must be before end time",
    path: ["endTime"],
  });

// =====================================================
// UPDATE SERVICE BOOKING SCHEDULE
// =====================================================

const updateServiceBookingScheduleValidationSchema = z.object({
  params: z.object({
    serviceId: z.uuid("Invalid service ID"),
    branchId: z.uuid("Invalid branch ID"),
  }),

  body: z
    .object({
      bookingHoursEnabled: z.boolean(),

      bookingWindows: z.array(serviceBookingWindowSchema).default([]),
    })
    .strict()
    .superRefine((data, ctx) => {
      // ===============================================
      // 1. REQUIRE WINDOWS WHEN ENABLED
      // ===============================================

      if (data.bookingHoursEnabled && data.bookingWindows.length === 0) {
        ctx.addIssue({
          code: "custom",
          path: ["bookingWindows"],
          message:
            "At least one booking window is required when booking hours are enabled",
        });
      }

      // ===============================================
      // 2. GROUP WINDOWS BY DAY
      // ===============================================

      const windowsByDay = new Map<
        string,
        Array<{
          startTime: string;
          endTime: string;
        }>
      >();

      for (const window of data.bookingWindows) {
        const existingWindows = windowsByDay.get(window.day) ?? [];

        existingWindows.push({
          startTime: window.startTime,
          endTime: window.endTime,
        });

        windowsByDay.set(window.day, existingWindows);
      }

      // ===============================================
      // 3. CHECK OVERLAPPING WINDOWS
      // ===============================================

      for (const [day, windows] of windowsByDay) {
        const sortedWindows = [...windows].sort((a, b) =>
          a.startTime.localeCompare(b.startTime),
        );

        for (let i = 1; i < sortedWindows.length; i++) {
          const previous = sortedWindows[i - 1];
          const current = sortedWindows[i];

          if (current.startTime < previous.endTime) {
            ctx.addIssue({
              code: "custom",
              path: ["bookingWindows"],
              message: `Overlapping booking windows are not allowed on ${day}`,
            });
          }
        }
      }
    }),
});
export const serviceValidation = {
  createServiceValidationSchema,
  updateServiceValidationSchema,
  updateServiceStatusValidationSchema,
  assignServiceBranchesValidationSchema,
  updateServiceBookingScheduleValidationSchema,
};
