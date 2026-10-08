import { z } from "zod";

const createGroupPurchaseValidationSchema = z.object({
  body: z.object({
    packageId: z.string().uuid("Invalid package ID"),

    quantity: z.number().int().positive("Quantity must be greater than 0"),
  }),
});

const createGroupPurchaseAppointmentValidationSchema = z.object({
  body: z.object({
    branchId: z.string().uuid(),

    staffId: z.string().uuid().optional(),

    date: z.iso.date(),

    startTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Start time must be in HH:mm format"),
  }),
});

export const groupPurchaseValidation = {
  createGroupPurchaseValidationSchema,
  createGroupPurchaseAppointmentValidationSchema,
};
