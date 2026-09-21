import { z } from "zod";

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

    imageObjectKeys: z
      .array(z.string().min(1, "Invalid image object key"))
      .min(1, "At least one service image is required"),
  }),
});

const updateServiceValidationSchema = z.object({
  body: z.object({
    name: z.string().min(2).max(100).optional(),

    description: z.string().max(1000).optional(),

    price: z.number().positive().optional(),

    durationMinutes: z.number().int().positive().optional(),
  }),
});

const updateServiceStatusValidationSchema = z.object({
  body: z.object({
    status: z.enum(["ACTIVE", "INACTIVE"]),
  }),
});

const assignServiceBranchesValidationSchema = z.object({
  body: z.object({
    branchIds: z
      .array(z.string().uuid("Invalid branch ID"))
      .min(1, "At least one branch is required"),
  }),
});

export const serviceValidation = {
  createServiceValidationSchema,
  updateServiceValidationSchema,
  updateServiceStatusValidationSchema,
  assignServiceBranchesValidationSchema,
};
