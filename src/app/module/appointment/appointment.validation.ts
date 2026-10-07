import { z } from "zod";

const createPayNowValidationSchema = z.object({
  body: z
    .object({
      branchId: z.uuid("Invalid branchId"),

      serviceId: z.uuid("Invalid serviceId").nullable().optional(),

      packageId: z.uuid("Invalid packageId").nullable().optional(),

      staffId: z.uuid("Invalid staffId").nullable().optional(),

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

      staffId: z.uuid("Invalid staffId").nullable().optional(),

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

    staffId: z.uuid("Invalid staffId").nullable().optional(),
  }),
});

const verifyQrValidationSchema = z.object({
  body: z.object({
    qrToken: z.string().trim().min(1, "QR token is required"),

    branchId: z.uuid("Invalid branchId"),
  }),
});

const completeAppointmentValidationSchema = z.object({
  body: z.object({
    notes: z
      .string()
      .trim()
      .max(1000, "Notes must not exceed 1000 characters")
      .optional(),
  }),
});

const markNoShowValidationSchema = z.object({
  body: z.object({
    reason: z
      .string()
      .trim()
      .min(1, "Reason is required")
      .max(500, "Reason must not exceed 500 characters"),
  }),
});

const getBranchAppointmentsValidationSchema = z.object({
  body: z.object({
    page: z
      .string()
      .regex(/^\d+$/, "page must be a positive integer")
      .optional(),

    limit: z
      .string()
      .regex(/^\d+$/, "limit must be a positive integer")
      .optional(),

    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD")
      .optional(),

    staffId: z.uuid("Invalid staffId").optional(),

    bookingMethod: z.enum(["PAY_NOW", "RESERVE_NOW", "DEPOSIT"]).optional(),

    appointmentStatus: z
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

    paymentStatus: z
      .enum([
        "UNPAID",
        "PENDING",
        "PARTIALLY_PAID",
        "PAID",
        "FAILED",
        "REFUNDED",
        "PARTIALLY_REFUNDED",
      ])
      .optional(),
  }),
});

const getAllAppointmentsValidationSchema = z.object({
  body: z
    .object({
      page: z
        .string()
        .regex(/^\d+$/, "page must be a positive integer")
        .optional(),

      limit: z
        .string()
        .regex(/^\d+$/, "limit must be a positive integer")
        .optional(),

      branchId: z.uuid("Invalid branchId").optional(),

      staffId: z.uuid("Invalid staffId").optional(),

      serviceId: z.uuid("Invalid serviceId").optional(),

      packageId: z.uuid("Invalid packageId").optional(),

      bookingMethod: z.enum(["PAY_NOW", "RESERVE_NOW", "DEPOSIT"]).optional(),

      appointmentStatus: z
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

      paymentStatus: z
        .enum([
          "UNPAID",
          "PENDING",
          "PARTIALLY_PAID",
          "PAID",
          "FAILED",
          "REFUNDED",
          "PARTIALLY_REFUNDED",
        ])
        .optional(),

      from: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "from must be YYYY-MM-DD")
        .optional(),

      to: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "to must be YYYY-MM-DD")
        .optional(),
    })
    .superRefine((data, ctx) => {
      if (data.from && data.to && data.from > data.to) {
        ctx.addIssue({
          code: "custom",
          path: ["to"],
          message: "to must be on or after from",
        });
      }
    }),
});

const createDepositAppointmentValidationSchema = z.object({
  body: z
    .object({
      branchId: z.string().uuid("Invalid branchId"),

      serviceId: z.string().uuid("Invalid serviceId").optional(),

      packageId: z.string().uuid("Invalid packageId").optional(),

      staffId: z.string().uuid("Invalid staffId").nullable().optional(),

      date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format"),

      startTime: z
        .string()
        .regex(
          /^([01]\d|2[0-3]):[0-5]\d$/,
          "Start time must be in HH:mm format",
        ),
    })
    .superRefine((data, ctx) => {
      const hasService = Boolean(data.serviceId);
      const hasPackage = Boolean(data.packageId);

      if (hasService === hasPackage) {
        ctx.addIssue({
          code: "custom",
          path: ["serviceId"],
          message: "Exactly one of serviceId or packageId is required",
        });
      }
    }),
});

const recordRemainingPaymentValidationSchema = z.object({
  body: z.object({
    paymentMethod: z.enum(["CASH", "CARD", "FPS", "OTHER"]),
  }),
});

export const appointmentValidation = {
  createPayNowValidationSchema,
  createReserveValidationSchema,
  getMyAppointmentsValidationSchema,
  getAppointmentValidationSchema,
  cancelAppointmentValidationSchema,
  rescheduleAppointmentValidationSchema,
  verifyQrValidationSchema,
  completeAppointmentValidationSchema,
  markNoShowValidationSchema,
  getBranchAppointmentsValidationSchema,
  getAllAppointmentsValidationSchema,
  createDepositAppointmentValidationSchema,
  recordRemainingPaymentValidationSchema,
};
