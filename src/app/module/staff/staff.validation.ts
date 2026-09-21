import { z } from "zod";

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

export const staffValidation = {
  createStaffValidationSchema,
  updateStaffValidationSchema,
  updateStaffStatusValidationSchema,
  assignStaffBranchesValidationSchema,
  assignStaffServicesValidationSchema,
  assignStaffPackagesValidationSchema,
};
