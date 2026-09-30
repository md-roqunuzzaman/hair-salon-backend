import { z } from "zod";

const getWalletTransactionsValidationSchema = z.object({
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

      type: z
        .enum([
          "TOP_UP",
          "BONUS",
          "APPOINTMENT_PAYMENT",
          "GROUP_PURCHASE_PAYMENT",
          "REFUND",
          "ADJUSTMENT",
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

const createWalletTopupValidationSchema = z.object({
  body: z.object({
    amount: z.number().positive("Top-up amount must be greater than 0"),
  }),
});

const payAppointmentWithWalletValidationSchema = z.object({
  body: z.object({
    useBonus: z.boolean(),
  }),
});

export const walletValidation = {
  getWalletTransactionsValidationSchema,
  createWalletTopupValidationSchema,
  payAppointmentWithWalletValidationSchema,
};
