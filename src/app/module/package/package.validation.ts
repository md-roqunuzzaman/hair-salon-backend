import { z } from "zod";

const createPackageValidationSchema = z
  .object({
    body: z.object({
      type: z.enum(["STANDARD_SERVICE_PACKAGE", "GROUP_PURCHASE_PACKAGE"]),

      name: z
        .string()
        .min(2, "Package name must be at least 2 characters")
        .max(120, "Package name must not exceed 120 characters"),

      description: z
        .string()
        .max(1500, "Description must not exceed 1500 characters")
        .optional(),

      serviceIds: z
        .array(z.string().uuid("Invalid service ID"))
        .min(1, "At least one service is required"),

      regularPrice: z.number().positive("Regular price must be greater than 0"),

      packagePrice: z.number().positive("Package price must be greater than 0"),

      durationMinutes: z
        .number()
        .int()
        .positive("Duration must be greater than 0"),

      branchIds: z
        .array(z.string().uuid("Invalid branch ID"))
        .min(1, "At least one branch is required"),

      imageObjectKeys: z
        .array(z.string().min(1, "Invalid image object key"))
        .min(1, "At least one package image is required"),

      listingStatus: z.enum(["LISTED", "DELISTED"]),

      capacity: z
        .number()
        .int()
        .positive("Capacity must be greater than 0")
        .optional(),

      purchaseLimitPerCustomer: z
        .number()
        .int()
        .positive("Purchase limit must be greater than 0")
        .optional(),

      salesStartAt: z.string().datetime({ offset: true }).optional(),

      salesEndAt: z.string().datetime({ offset: true }).optional(),
    }),
  })
  .superRefine((data, ctx) => {
    const body = data.body;

    if (body.packagePrice > body.regularPrice) {
      ctx.addIssue({
        code: "custom",
        path: ["body", "packagePrice"],
        message: "Package price cannot be greater than regular price",
      });
    }

    if (body.type === "STANDARD_SERVICE_PACKAGE") {
      if (body.capacity !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["body", "capacity"],
          message: "Capacity is not allowed for standard service packages",
        });
      }

      if (body.purchaseLimitPerCustomer !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["body", "purchaseLimitPerCustomer"],
          message:
            "Purchase limit is not allowed for standard service packages",
        });
      }

      if (body.salesStartAt !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["body", "salesStartAt"],
          message:
            "Sales start time is not allowed for standard service packages",
        });
      }

      if (body.salesEndAt !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["body", "salesEndAt"],
          message:
            "Sales end time is not allowed for standard service packages",
        });
      }
    }

    if (body.type === "GROUP_PURCHASE_PACKAGE") {
      if (body.capacity === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["body", "capacity"],
          message: "Capacity is required for group purchase packages",
        });
      }

      if (body.purchaseLimitPerCustomer === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["body", "purchaseLimitPerCustomer"],
          message:
            "Purchase limit per customer is required for group purchase packages",
        });
      }

      if (!body.salesStartAt) {
        ctx.addIssue({
          code: "custom",
          path: ["body", "salesStartAt"],
          message: "Sales start time is required for group purchase packages",
        });
      }

      if (!body.salesEndAt) {
        ctx.addIssue({
          code: "custom",
          path: ["body", "salesEndAt"],
          message: "Sales end time is required for group purchase packages",
        });
      }

      if (
        body.salesStartAt &&
        body.salesEndAt &&
        new Date(body.salesStartAt) >= new Date(body.salesEndAt)
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["body", "salesEndAt"],
          message: "Sales end time must be later than sales start time",
        });
      }

      if (
        body.capacity !== undefined &&
        body.purchaseLimitPerCustomer !== undefined &&
        body.purchaseLimitPerCustomer > body.capacity
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["body", "purchaseLimitPerCustomer"],
          message: "Purchase limit per customer cannot exceed package capacity",
        });
      }
    }
  });

const updatePackageValidationSchema = z.object({
  body: z.object({
    name: z.string().min(2).max(120).optional(),

    description: z.string().max(1500).optional(),

    regularPrice: z.number().positive().optional(),

    packagePrice: z.number().positive().optional(),

    durationMinutes: z.number().int().positive().optional(),

    capacity: z.number().int().positive().optional(),

    purchaseLimitPerCustomer: z.number().int().positive().optional(),

    salesStartAt: z.string().datetime({ offset: true }).optional(),

    salesEndAt: z.string().datetime({ offset: true }).optional(),
  }),
});

const updatePackageStatusValidationSchema = z.object({
  body: z.object({
    status: z.enum(["ACTIVE", "INACTIVE"]),
  }),
});
const updatePackageListingValidationSchema = z.object({
  body: z.object({
    listingStatus: z.enum(["LISTED", "DELISTED"]),
  }),
});

const assignPackageBranchesValidationSchema = z.object({
  body: z.object({
    branchIds: z
      .array(z.string().uuid("Invalid branch ID"))
      .min(1, "At least one branch is required"),
  }),
});

export const packageValidation = {
  createPackageValidationSchema,
  updatePackageValidationSchema,
  updatePackageStatusValidationSchema,
  updatePackageListingValidationSchema,
  assignPackageBranchesValidationSchema,
};
