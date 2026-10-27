import {
  BookingMethod,
  PaymentStatus,
} from "../../../generated/prisma/client.js";

export type PaymentDisplayStatus =
  | "UNPAID"
  | "PAYMENT_PENDING"
  | "DEPOSIT_PAID"
  | "PARTIALLY_PAID"
  | "FULLY_PAID"
  | "PAYMENT_FAILED"
  | "PARTIALLY_REFUNDED"
  | "REFUNDED";

export const getPaymentDisplayStatus = (
  paymentStatus: PaymentStatus,
  bookingMethod: BookingMethod,
  depositPaid: boolean = false,
): PaymentDisplayStatus => {
  switch (paymentStatus) {
    case PaymentStatus.UNPAID:
      return "UNPAID";

    case PaymentStatus.PENDING:
      return "PAYMENT_PENDING";

    case PaymentStatus.PAID:
      return "FULLY_PAID";

    case PaymentStatus.FAILED:
      return "PAYMENT_FAILED";

    case PaymentStatus.REFUNDED:
      return "REFUNDED";

    case PaymentStatus.PARTIALLY_REFUNDED:
      return "PARTIALLY_REFUNDED";

    case PaymentStatus.PARTIALLY_PAID:
      if (bookingMethod === BookingMethod.DEPOSIT && depositPaid) {
        return "DEPOSIT_PAID";
      }

      return "PARTIALLY_PAID";

    default:
      return "UNPAID";
  }
};
