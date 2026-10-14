import { z } from "zod";

export const createRefundRequestValidationSchema = z.object({
  body: z.object({
    paymentId: z.string().uuid(),

    reason: z
      .string()
      .trim()
      .min(5, "Refund reason must contain at least 5 characters")
      .max(500),
  }),
});

export const getRefundRequestsValidationSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),

    status: z
      .enum([
        "PENDING",
        "APPROVED",
        "REJECTED",
        "PROCESSING",
        "COMPLETED",
        "FAILED",
      ])
      .optional(),
  }),
});

export const reviewRefundRequestValidationSchema = z.object({
  body: z
    .object({
      decision: z.enum(["APPROVE", "REJECT"]),

      reviewNote: z.string().trim().max(500).optional(),
    })
    .superRefine((data, ctx) => {
      if (data.decision === "REJECT" && !data.reviewNote?.trim()) {
        ctx.addIssue({
          code: "custom",
          path: ["reviewNote"],
          message: "Review note is required when rejecting",
        });
      }
    }),
});
export const processRefundRequestValidationSchema = z.object({
  body: z.object({}).strict(),
});
