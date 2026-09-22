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
  body: z.object({
    type: z.enum(["BREAK", "TIME_OFF", "LEAVE", "BLOCKED"]),

    date: z.string().regex(dateRegex, "date must be in YYYY-MM-DD format"),

    startTime: z.string().regex(timeRegex, "startTime must be in HH:mm format"),

    endTime: z.string().regex(timeRegex, "endTime must be in HH:mm format"),

    reason: z.string().max(500).optional(),
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
};
