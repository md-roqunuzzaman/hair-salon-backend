import { z } from "zod";

const staffLocaleSchema = z
  .object({
    roleTitle: z.string().trim().min(2).max(100).optional(),

    specialization: z.string().trim().max(150).optional(),

    description: z.string().trim().max(1000).optional(),
  })
  .strict();

const staffTranslationsSchema = z
  .object({
    en: staffLocaleSchema.optional(),

    "zh-CN": staffLocaleSchema.optional(),

    "zh-HK": staffLocaleSchema.optional(),
  })
  .strict();

const createStaffValidationSchema = z.object({
  body: z.object({
    name: z
      .string()
      .min(2, "Staff name must be at least 2 characters")
      .max(100, "Staff name must not exceed 100 characters"),

    email: z.string().email("Invalid email address"),

    phone: z
      .string()
      .min(6, "Invalid phone number")
      .max(30, "Invalid phone number")
      .optional(),

    roleTitle: z.string().min(2, "Role title is required").max(100),

    specialization: z.string().max(150).optional(),

    description: z.string().max(1000).optional(),

    branchIds: z
      .array(z.string().uuid("Invalid branch ID"))
      .min(1, "At least one branch is required"),

    serviceIds: z.array(z.string().uuid("Invalid service ID")).default([]),

    packageIds: z.array(z.string().uuid("Invalid package ID")).default([]),

    avatarObjectKey: z.string().min(1).optional(),
    translations: staffTranslationsSchema.optional(),
  }),
});

const updateStaffValidationSchema = z.object({
  body: z.object({
    name: z.string().min(2).max(100).optional(),

    phone: z.string().min(6).max(30).optional(),

    roleTitle: z.string().min(2).max(100).optional(),

    specialization: z.string().max(150).optional(),

    description: z.string().max(1000).optional(),

    avatarObjectKey: z.string().min(1).optional(),
    translations: staffTranslationsSchema.optional(),
  }),
});

const updateStaffStatusValidationSchema = z.object({
  body: z.object({
    status: z.enum(["ACTIVE", "INACTIVE"]),
  }),
});

const assignStaffBranchesValidationSchema = z.object({
  body: z.object({
    branchIds: z
      .array(z.string().uuid("Invalid branch ID"))
      .min(1, "At least one branch is required"),
  }),
});

const assignStaffServicesValidationSchema = z.object({
  body: z.object({
    serviceIds: z.array(z.string().uuid("Invalid service ID")),
  }),
});

const assignStaffPackagesValidationSchema = z.object({
  body: z.object({
    packageIds: z.array(z.string().uuid("Invalid package ID")),
  }),
});

const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;

const updateStaffScheduleValidationSchema = z.object({
  body: z.object({
    schedule: z
      .array(
        z.object({
          day: z.enum([
            "MONDAY",
            "TUESDAY",
            "WEDNESDAY",
            "THURSDAY",
            "FRIDAY",
            "SATURDAY",
            "SUNDAY",
          ]),

          branchId: z.string().uuid("Invalid branch ID"),

          startTime: z
            .string()
            .regex(timeRegex, "startTime must be in HH:mm format"),

          endTime: z
            .string()
            .regex(timeRegex, "endTime must be in HH:mm format"),
        }),
      )
      .min(1, "At least one schedule item is required"),
  }),
});

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

const createStaffUnavailabilityValidationSchema = z.object({
  body: z
    .object({
      type: z.enum(["BREAK", "TIME_OFF", "LEAVE", "BLOCKED"]),

      // Existing single-day support
      date: z
        .string()
        .regex(dateRegex, "date must be in YYYY-MM-DD format")
        .optional(),

      startTime: z
        .string()
        .regex(timeRegex, "startTime must be in HH:mm format")
        .optional(),

      endTime: z
        .string()
        .regex(timeRegex, "endTime must be in HH:mm format")
        .optional(),

      // New multiple-day support
      startDate: z
        .string()
        .regex(dateRegex, "startDate must be in YYYY-MM-DD format")
        .optional(),

      endDate: z
        .string()
        .regex(dateRegex, "endDate must be in YYYY-MM-DD format")
        .optional(),

      fullDay: z.boolean().optional(),

      reason: z.string().trim().max(500).optional(),
    })
    .superRefine((data, ctx) => {
      const addError = (path: string, message: string) => {
        ctx.addIssue({
          code: "custom",
          path: [path],
          message,
        });
      };

      const parseDate = (value: string | undefined) => {
        if (!value || !dateRegex.test(value)) return null;

        const date = new Date(`${value}T00:00:00.000Z`);

        if (
          Number.isNaN(date.getTime()) ||
          date.toISOString().slice(0, 10) !== value
        ) {
          return null;
        }

        return date;
      };

      // ---------------------------------------------
      // Date validation
      // ---------------------------------------------

      if (data.date && data.startDate) {
        addError("date", "Use either date or startDate, not both");
      }

      if (!data.date && !data.startDate) {
        addError("date", "date or startDate is required");
      }

      if (data.endDate && !data.startDate) {
        addError("endDate", "startDate is required when endDate is provided");
      }

      for (const field of ["date", "startDate", "endDate"] as const) {
        const value = data[field];

        if (value && !parseDate(value)) {
          addError(field, `${field} must be a valid calendar date`);
        }
      }

      const start = parseDate(data.startDate ?? data.date);
      const end = parseDate(data.endDate ?? data.startDate ?? data.date);

      if (start && end) {
        if (start > end) {
          addError("endDate", "endDate must not be earlier than startDate");
        } else {
          const totalDays =
            Math.round((end.getTime() - start.getTime()) / 86400000) + 1;

          if (totalDays > 31) {
            addError(
              "endDate",
              "Unavailability duration cannot exceed 31 days",
            );
          }

          if (totalDays > 1 && !["LEAVE", "TIME_OFF"].includes(data.type)) {
            addError(
              "type",
              "Multiple-day unavailability is only supported for LEAVE and TIME_OFF",
            );
          }
        }
      }

      // ---------------------------------------------
      // Full-day validation
      // ---------------------------------------------

      if (data.fullDay === true) {
        if (!["LEAVE", "TIME_OFF"].includes(data.type)) {
          addError(
            "fullDay",
            "Full-day unavailability is only supported for LEAVE and TIME_OFF",
          );
        }

        if (data.startTime || data.endTime) {
          addError(
            "fullDay",
            "Do not provide startTime or endTime for full-day leave",
          );
        }
      } else {
        // Existing time-based behavior

        if (!data.startTime) {
          addError("startTime", "startTime is required");
        }

        if (!data.endTime) {
          addError("endTime", "endTime is required");
        }

        if (data.startTime && data.endTime) {
          const toMinutes = (time: string) => {
            const [hours, minutes] = time.split(":").map(Number);
            return hours * 60 + minutes;
          };

          if (
            timeRegex.test(data.startTime) &&
            timeRegex.test(data.endTime) &&
            toMinutes(data.startTime) >= toMinutes(data.endTime)
          ) {
            addError("endTime", "endTime must be later than startTime");
          }
        }
      }
    }),
});

const updateStaffUnavailabilityValidationSchema = z.object({
  body: z.object({
    type: z.enum(["BREAK", "TIME_OFF", "LEAVE", "BLOCKED"]).optional(),

    date: z
      .string()
      .regex(dateRegex, "date must be in YYYY-MM-DD format")
      .optional(),

    startTime: z
      .string()
      .regex(timeRegex, "startTime must be in HH:mm format")
      .optional(),

    endTime: z
      .string()
      .regex(timeRegex, "endTime must be in HH:mm format")
      .optional(),

    reason: z.string().max(500).optional(),
  }),
});

const getMyAppointmentsValidationSchema = z.object({
  body: z.object({
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD")
      .optional(),

    status: z
      .enum([
        "PENDING_PAYMENT",
        "RESERVED",
        "CONFIRMED",
        "COMPLETED",
        "CANCELLED",
        "NO_SHOW",
        "EXPIRED",
      ])
      .optional(),

    page: z
      .string()
      .regex(/^\d+$/, "page must be a positive integer")
      .optional(),

    limit: z
      .string()
      .regex(/^\d+$/, "limit must be a positive integer")
      .optional(),
  }),
});

export const staffValidation = {
  createStaffValidationSchema,
  updateStaffValidationSchema,
  updateStaffStatusValidationSchema,
  assignStaffBranchesValidationSchema,
  assignStaffServicesValidationSchema,
  assignStaffPackagesValidationSchema,
  updateStaffScheduleValidationSchema,
  createStaffUnavailabilityValidationSchema,
  updateStaffUnavailabilityValidationSchema,
  getMyAppointmentsValidationSchema,
};
