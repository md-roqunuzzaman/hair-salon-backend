import { z } from "zod";

const imageObjectKeySchema = z
  .string()
  .trim()
  .min(1, "Image object key cannot be empty");

const createReviewValidationSchema = z.object({
  body: z.object({
    rating: z
      .number()
      .int()
      .min(1, "Rating must be at least 1")
      .max(5, "Rating cannot exceed 5"),

    comment: z
      .string()
      .trim()
      .max(2000, "Comment cannot exceed 2000 characters")
      .optional(),

    imageObjectKeys: z
      .array(imageObjectKeySchema)
      .max(10, "A maximum of 10 review images is allowed")
      .default([]),
  }),
});

const getReviewsValidationSchema = z.object({
  body: z.object({
    page: z.coerce.number().int().positive().default(1),

    limit: z.coerce.number().int().positive().max(100).default(20),

    rating: z.coerce.number().int().min(1).max(5).optional(),
  }),
});

const updateReviewValidationSchema = z.object({
  body: z
    .object({
      rating: z
        .number()
        .int()
        .min(1, "Rating must be at least 1")
        .max(5, "Rating cannot exceed 5")
        .optional(),

      comment: z
        .string()
        .trim()
        .max(2000, "Comment cannot exceed 2000 characters")
        .optional(),

      imageObjectKeys: z
        .array(imageObjectKeySchema)
        .max(10, "A maximum of 10 review images is allowed")
        .optional(),
    })
    .refine((data) => Object.keys(data).length > 0, {
      message: "At least one field is required",
    }),
});

const moderateReviewValidationSchema = z.object({
  body: z.object({
    moderationStatus: z.enum(["VISIBLE", "HIDDEN"]),

    reason: z
      .string()
      .trim()
      .max(500, "Moderation reason cannot exceed 500 characters")
      .optional(),
  }),
});

const reviewReplyValidationSchema = z.object({
  body: z.object({
    reply: z
      .string()
      .trim()
      .min(1, "Reply is required")
      .max(2000, "Reply cannot exceed 2000 characters"),
  }),
});

export const reviewValidation = {
  createReviewValidationSchema,
  getReviewsValidationSchema,
  updateReviewValidationSchema,
  moderateReviewValidationSchema,
  reviewReplyValidationSchema,
};
