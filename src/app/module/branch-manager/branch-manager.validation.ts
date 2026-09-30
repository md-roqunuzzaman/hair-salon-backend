import { z } from "zod";

const createBranchManagerValidationSchema = z.object({
  body: z.object({
    name: z.string().trim().min(1).max(100),

    email: z.string().trim().email(),

    phone: z.string().trim().min(1).optional(),

    branchIds: z
      .array(z.string().uuid())
      .min(1, "At least one branch is required")
      .refine((ids) => new Set(ids).size === ids.length, {
        message: "branchIds must not contain duplicates",
      }),
  }),
});

const updateBranchManagerBranchesValidationSchema = z.object({
  body: z.object({
    branchIds: z
      .array(z.string().uuid())
      .min(1, "At least one branch is required")
      .refine((ids) => new Set(ids).size === ids.length, {
        message: "branchIds must not contain duplicates",
      }),
  }),
});

const updateBranchManagerStatusValidationSchema = z.object({
  body: z.object({
    status: z.enum(["ACTIVE", "INACTIVE"]),
  }),
});

export const branchManagerValidation = {
  createBranchManagerValidationSchema,
  updateBranchManagerBranchesValidationSchema,
  updateBranchManagerStatusValidationSchema,
};
