import { z } from "zod";

const getAvailabilityValidationSchema = z.object({
  body: z
    .object({
      branchId: z.uuid("Invalid branchId"),

      serviceId: z.uuid("Invalid serviceId").optional(),

      packageId: z.uuid("Invalid packageId").optional(),

      staffId: z.uuid("Invalid staffId").optional(),

      staff: z.literal("ANY").optional(),

      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
    })
    .superRefine((data, ctx) => {
      const hasService = Boolean(data.serviceId);
      const hasPackage = Boolean(data.packageId);

      if (hasService === hasPackage) {
        ctx.addIssue({
          code: "custom",
          path: ["serviceId"],
          message: "Provide exactly one of serviceId or packageId",
        });
      }

      const hasStaffId = Boolean(data.staffId);
      const hasAnyStaff = data.staff === "ANY";

      if (hasStaffId === hasAnyStaff) {
        ctx.addIssue({
          code: "custom",
          path: ["staffId"],
          message: "Provide exactly one of staffId or staff=ANY",
        });
      }

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
