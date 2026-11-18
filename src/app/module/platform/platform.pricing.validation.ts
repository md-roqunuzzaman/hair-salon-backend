import { z } from "zod";

// =====================================================
// 1. VALIDATE PRICE
// =====================================================

export const updatePricingSchema = z
  .object({
    price: z
      .number()
      .finite()
      .nonnegative()
      .refine(
        (value) => Number.isInteger(Math.round(value * 1000000) / 10000),
        "Price must have at most 2 decimal places",
      ),
  })
  .strict();

export type TUpdatePricing = z.infer<typeof updatePricingSchema>;
