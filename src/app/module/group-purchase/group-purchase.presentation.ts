import { BookingMethod, GroupPurchaseFlow, PaymentStatus, Prisma } from "../../../../generated/prisma/client.js";
import config from "../../config/index.js";

export const groupPurchaseOptions = () => ({
  availablePurchaseFlows: [GroupPurchaseFlow.BUY_NOW_BOOK_LATER, ...(config.enable_book_now_purchase ? [GroupPurchaseFlow.DIRECT_BOOK] : [])],
  staffSelectionRequired: false,
  buyLaterRequiresFullPayment: true,
  onlinePaymentProviders: ["STRIPE", "WALLET"],
});

interface PurchaseSnapshot {
  purchaseFlow: GroupPurchaseFlow;
  bookingMethod: BookingMethod | null;
  paymentStatus: PaymentStatus;
  amount: Prisma.Decimal;
  depositPercentage: Prisma.Decimal | null;
  depositAmount: Prisma.Decimal | null;
  remainingAmount: Prisma.Decimal | null;
  reservationExpiresAt: Date | null;
}

// Payment amounts are persisted snapshots, never recomputed from today's policy.
export const presentGroupPurchase = (purchase: PurchaseSnapshot, qrVerified = false) => {
  const pending = purchase.paymentStatus === PaymentStatus.PENDING &&
    purchase.reservationExpiresAt !== null && purchase.reservationExpiresAt > new Date();
  const reserve = purchase.bookingMethod === BookingMethod.RESERVE_NOW;
  const deposit = purchase.bookingMethod === BookingMethod.DEPOSIT;
  const onlinePaymentRequired = pending && !reserve;
  const salonPaymentRequired = (reserve && purchase.paymentStatus === PaymentStatus.UNPAID) ||
    (deposit && purchase.paymentStatus === PaymentStatus.PARTIALLY_PAID);
  return {
    purchaseFlow: purchase.purchaseFlow,
    bookingMethod: purchase.bookingMethod,
    currency: "HKD",
    depositPercentage: purchase.depositPercentage === null ? null : Number(purchase.depositPercentage),
    depositAmount: purchase.depositAmount === null ? null : Number(purchase.depositAmount),
    // Historical agreed remainder; amountDueAtSalon below reflects current settlement.
    remainingAmount: purchase.remainingAmount === null ? null : Number(purchase.remainingAmount),
    onlinePaymentRequired,
    amountDueOnline: onlinePaymentRequired ? Number(deposit ? purchase.depositAmount : purchase.amount) : 0,
    salonPaymentRequired,
    amountDueAtSalon: salonPaymentRequired ? Number(reserve ? purchase.amount : purchase.remainingAmount) : 0,
    // Verification is still required only until the initial appointment is verified.
    qrVerificationRequired: salonPaymentRequired && !qrVerified,
  };
};
