import { z } from "zod";
import { SalonPaymentMethod } from "../../../../generated/prisma/enums.js";

const createGroupPurchaseValidationSchema = z.object({
  body: z
    .object({
      // =====================================================
      // 1. GROUP PURCHASE PACKAGE
      // =====================================================

      packageId: z.uuid("Invalid package ID"),

      // =====================================================
      // 2. VOUCHER QUANTITY
      // =====================================================

      quantity: z.number().int().positive(),

      // =====================================================
      // 3. PURCHASE FLOW - VOUCHER ONLY
      // =====================================================

      purchaseFlow: z
        .literal("BUY_NOW_BOOK_LATER")
        .default("BUY_NOW_BOOK_LATER"),

      // =====================================================
      // 4. OPTIONAL PURCHASE BRANCH
      // Used for branch-specific refund policy snapshot.
      // =====================================================

      branchId: z.uuid("Invalid branch ID").optional(),
    })
    .strict(),
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

const recordGroupPurchaseRemainingPaymentValidationSchema = z.object({
  body: z
    .object({
      paymentMethod: z.nativeEnum(SalonPaymentMethod),
    })
    .strict(),
});

export const groupPurchaseValidation = {
  createGroupPurchaseValidationSchema,
  createGroupPurchaseAppointmentValidationSchema,
  recordGroupPurchaseRemainingPaymentValidationSchema,
};
