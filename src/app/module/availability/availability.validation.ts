import { z } from "zod";

const getAvailabilityValidationSchema = z.object({
  body: z
    .object({
      branchId: z.uuid("Invalid branchId"),

      serviceId: z.uuid("Invalid serviceId").optional(),

      packageId: z.uuid("Invalid packageId").optional(),

      staffId: z.uuid("Invalid staffId").optional(),

      // Backward compatibility
      staff: z.literal("ANY").optional(),

      // Issue #152: Optional staff preference
      staffPreference: z
        .enum(["SELECT_STAFF", "AUTO_ASSIGN", "NO_STAFF"])
        .optional(),

      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
    })
    .superRefine((data, ctx) => {
      // ================================================
      // EXACTLY ONE SERVICE OR PACKAGE
      // ================================================

      const hasService = Boolean(data.serviceId);
      const hasPackage = Boolean(data.packageId);

      if (hasService === hasPackage) {
        ctx.addIssue({
          code: "custom",
          path: ["serviceId"],
          message: "Provide exactly one of serviceId or packageId",
        });
      }

      // ================================================
      // CANNOT SEND BOTH SPECIFIC STAFF + ANY
      // ================================================

      if (data.staffId && data.staff === "ANY") {
        ctx.addIssue({
          code: "custom",
          path: ["staffId"],
          message: "Provide staffId or staff=ANY, not both",
        });
      }

      // ================================================
      // SELECT_STAFF REQUIRES STAFF ID
      // ================================================

      if (data.staffPreference === "SELECT_STAFF" && !data.staffId) {
        ctx.addIssue({
          code: "custom",
          path: ["staffId"],
          message: "staffId is required when staffPreference is SELECT_STAFF",
        });
      }

      // ================================================
      // AUTO_ASSIGN CANNOT HAVE STAFF ID
      // ================================================

      if (data.staffPreference === "AUTO_ASSIGN" && data.staffId) {
        ctx.addIssue({
          code: "custom",
          path: ["staffId"],
          message: "staffId cannot be provided with AUTO_ASSIGN",
        });
      }

      // ================================================
      // NO_STAFF CANNOT HAVE STAFF ID
      // ================================================

      if (data.staffPreference === "NO_STAFF" && data.staffId) {
        ctx.addIssue({
          code: "custom",
          path: ["staffId"],
          message: "staffId cannot be provided with NO_STAFF",
        });
      }

      // ================================================
      // LEGACY ANY CONFLICT VALIDATION
      // ================================================

      if (
        data.staff === "ANY" &&
        data.staffPreference &&
        data.staffPreference !== "AUTO_ASSIGN"
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["staffPreference"],
          message: "staff=ANY can only be used with AUTO_ASSIGN",
        });
      }

      // ================================================
      // DATE VALIDATION
      // ================================================

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

export const availabilityValidation = {
  getAvailabilityValidationSchema,
};
