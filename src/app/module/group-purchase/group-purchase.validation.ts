import { z } from "zod";
import { SalonPaymentMethod } from "../../../../generated/prisma/enums.js";

const createGroupPurchaseValidationSchema = z.object({
  body: z
    .object({
      packageId: z.string().uuid("Invalid package ID"),

      quantity: z.number().int().positive(),

      purchaseFlow: z
        .enum(["BUY_NOW_BOOK_LATER", "DIRECT_BOOK"])
        .default("BUY_NOW_BOOK_LATER"),

      bookingMethod: z.enum(["PAY_NOW", "DEPOSIT", "RESERVE_NOW"]).optional(),

      branchId: z.string().uuid().optional(),

      staffId: z.string().uuid().nullable().optional(),

      date: z.iso.date().optional(),

      startTime: z
        .string()
        .regex(
          /^([01]\d|2[0-3]):[0-5]\d$/,
          "Start time must be in HH:mm format",
        )
        .optional(),
    })
    .superRefine((data, ctx) => {
      if (data.purchaseFlow === "DIRECT_BOOK") {
        if (!data.bookingMethod) {
          ctx.addIssue({
            code: "custom",
            path: ["bookingMethod"],
            message: "bookingMethod is required for Book Now",
          });
        }

        if (!data.branchId) {
          ctx.addIssue({
            code: "custom",
            path: ["branchId"],
            message: "branchId is required for Book Now",
          });
        }

        if (!data.date) {
          ctx.addIssue({
            code: "custom",
            path: ["date"],
            message: "date is required for Book Now",
          });
        }

        if (!data.startTime) {
          ctx.addIssue({
            code: "custom",
            path: ["startTime"],
            message: "startTime is required for Book Now",
          });
        }
      } else {
        if (
          data.bookingMethod !== undefined ||
          data.staffId !== undefined ||
          data.date !== undefined ||
          data.startTime !== undefined
        ) {
          ctx.addIssue({
            code: "custom",
            path: ["purchaseFlow"],
            message: "Booking details are only allowed for DIRECT_BOOK",
          });
        }
      }
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
