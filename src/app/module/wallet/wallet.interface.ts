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

export interface ICreateWalletTopupPayload {
  amount: number;
}

export interface ICreateWalletTopupResponse {
  topupId: string;
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
