import { z } from "zod";

const createPayNowValidationSchema = z.object({
  body: z
    .object({
      branchId: z.uuid("Invalid branchId"),

      serviceId: z.uuid("Invalid serviceId").nullable().optional(),

      packageId: z.uuid("Invalid packageId").nullable().optional(),

      staffId: z.uuid("Invalid staffId"),

      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),

      startTime: z
        .string()
        .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "startTime must be HH:mm"),
    })
    .superRefine((data, ctx) => {
      const hasService = Boolean(data.serviceId);
      const hasPackage = Boolean(data.packageId);

      if (hasService === hasPackage) {
        ctx.addIssue({
          code: "custom",
          path: ["serviceId"],
          message: "Provide exactly one of serviceId or packageId",
        });
      }

      const parsedDate = new Date(`${data.date}T00:00:00.000Z`);

      if (
        Number.isNaN(parsedDate.getTime()) ||
        parsedDate.toISOString().slice(0, 10) !== data.date
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["date"],
          message: "Invalid date",
        });
      }
    }),
});

const createReserveValidationSchema = z.object({
  body: z
    .object({
      branchId: z.uuid("Invalid branchId"),

      serviceId: z.uuid("Invalid serviceId").nullable().optional(),

      packageId: z.uuid("Invalid packageId").nullable().optional(),

      staffId: z.uuid("Invalid staffId"),

      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),

      startTime: z
        .string()
        .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "startTime must be HH:mm"),
    })
    .superRefine((data, ctx) => {
      const hasService = Boolean(data.serviceId);
      const hasPackage = Boolean(data.packageId);

      if (hasService === hasPackage) {
        ctx.addIssue({
          code: "custom",
          path: ["serviceId"],
          message: "Provide exactly one of serviceId or packageId",
        });
      }

      const parsedDate = new Date(`${data.date}T00:00:00.000Z`);

      if (
        Number.isNaN(parsedDate.getTime()) ||
        parsedDate.toISOString().slice(0, 10) !== data.date
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["date"],
          message: "Invalid date",
        });
      }
    }),
});

const getMyAppointmentsValidationSchema = z.object({
  body: z.object({
    type: z.enum(["UPCOMING", "HISTORY"]),

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

const getAppointmentValidationSchema = z.object({
  body: z.object({
    appointmentId: z.uuid("Invalid appointmentId"),
  }),
});

const cancelAppointmentValidationSchema = z.object({
  body: z.object({
    reason: z
      .string()
      .trim()
      .min(2, "Cancellation reason is required")
      .max(500, "Cancellation reason must not exceed 500 characters"),
  }),
});

const rescheduleAppointmentValidationSchema = z.object({
  body: z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),

    startTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "startTime must be HH:mm"),

    staffId: z.uuid("Invalid staffId"),
  }),
});

export const appointmentValidation = {
  createPayNowValidationSchema,
  createReserveValidationSchema,
  getMyAppointmentsValidationSchema,
  getAppointmentValidationSchema,
  cancelAppointmentValidationSchema,
  rescheduleAppointmentValidationSchema,
};
