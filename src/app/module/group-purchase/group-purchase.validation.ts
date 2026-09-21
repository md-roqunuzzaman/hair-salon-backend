import { z } from "zod";

const createGroupPurchaseValidationSchema = z.object({
  body: z.object({
    packageId: z.string().uuid("Invalid package ID"),

    quantity: z.number().int().positive("Quantity must be greater than 0"),
  }),
});

export const groupPurchaseValidation = {
  createGroupPurchaseValidationSchema,
};
