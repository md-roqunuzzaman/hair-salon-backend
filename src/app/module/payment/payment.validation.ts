import { z } from "zod";

const createStripeIntentValidationSchema = z.object({
  body: z.object({
    appointmentId: z.uuid("Invalid appointmentId"),
  }),
});

const getMyPaymentsValidationSchema = z.object({
  body: z.object({
    page: z
      .string()
      .regex(/^\d+$/, "page must be a positive integer")
      .optional(),

    limit: z
      .string()
      .regex(/^\d+$/, "limit must be a positive integer")
      .optional(),

    status: z
      .enum(["PENDING", "PAID", "FAILED", "REFUNDED", "PARTIALLY_REFUNDED"])
      .optional(),
  }),
});

const refundPaymentValidationSchema = z.object({
  body: z.object({
    amount: z.number().positive("Refund amount must be greater than 0"),

    reason: z
      .string()
      .trim()
      .min(1, "Refund reason is required")
      .max(500, "Refund reason is too long"),
  }),
});

export const paymentValidation = {
  createStripeIntentValidationSchema,
  getMyPaymentsValidationSchema,
  refundPaymentValidationSchema,
};
