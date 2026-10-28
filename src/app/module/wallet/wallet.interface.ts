export interface IWalletResponse {
  paidBalance: number;
  bonusBalance: number;
  totalBalance: number;
  currency: string;
}

export interface IWalletTransactionsQuery {
  page?: string;
  limit?: string;

  type?:
    | "TOP_UP"
    | "BONUS"
    | "APPOINTMENT_PAYMENT"
    | "GROUP_PURCHASE_PAYMENT"
    | "REFUND"
    | "ADJUSTMENT";

  from?: string;
  to?: string;
}

export interface IWalletTransactionItem {
  id: string;
  type: string;
  balanceType: string;
  amount: number;
  createdAt: string;
}

// Customer selects a promotion instead of entering an amount
export interface ICreateWalletTopupPayload {
  promotionId: string;
}

export interface ICreateWalletTopupResponse {
  topupId: string;
  promotionId: string;
  amount: number;
  potentialBonus: number;
  stripeClientSecret: string;
}

export interface IPayAppointmentWithWalletPayload {
  useBonus: boolean;
}

export interface IPayAppointmentWithWalletResponse {
  paymentStatus: "PAID";
  paidBalanceUsed: number;
  bonusBalanceUsed: number;
  remainingPaidBalance: number;
  remainingBonusBalance: number;
}

export interface IPayAppointmentRemainingWithWalletPayload {
  useBonus: boolean;
}

export interface IPayAppointmentRemainingWithWalletResponse {
  appointmentId: string;
  paymentId: string;

  bookingMethod: "DEPOSIT";
  appointmentStatus: "CONFIRMED";
  paymentStatus: "PAID";

  amountPaid: number;
  currency: string;

  paidBalanceUsed: number;
  bonusBalanceUsed: number;

  remainingPaidBalance: number;
  remainingBonusBalance: number;
}

export interface IPayGroupPurchaseRemainingWithWalletPayload {
  useBonus: boolean;
}

export interface IPayGroupPurchaseRemainingWithWalletResponse {
  purchaseId: string;
  appointmentId: string;
  paymentId: string;

  bookingMethod: "DEPOSIT";
  paymentStatus: "PAID";
  appointmentStatus: "CONFIRMED";

  totalAmount: number;
  depositAmount: number;
  amountPaid: number;

  currency: string;

  paidBalanceUsed: number;
  bonusBalanceUsed: number;

  remainingPaidBalance: number;
  remainingBonusBalance: number;
}
