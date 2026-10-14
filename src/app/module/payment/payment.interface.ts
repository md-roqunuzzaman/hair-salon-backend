import { PaymentPurpose } from "../../../../generated/prisma/enums.js";

export interface ICreateStripeIntentPayload {
  appointmentId: string;
}

export interface ICreateStripeIntentResponse {
  paymentId: string;
  appointmentId: string;
  amount: number;
  currency: string;
  paymentStatus: "PENDING";
  clientSecret: string;
}

export interface IStripeWebhookResponse {
  received: true;
}

export interface IPaymentDetailsResponse {
  id: string;
  amount: number;
  currency: string;
  paymentStatus: string;
  provider: string;
  providerPaymentId: string | null;
  appointmentId: string | null;
}

export interface IMyPaymentsQuery {
  page?: string;
  limit?: string;

  status?: "PENDING" | "PAID" | "FAILED" | "REFUNDED" | "PARTIALLY_REFUNDED";
}

export interface IMyPaymentItem {
  id: string;

  amount: number;
  currency: string;

  paymentStatus: string;
  provider: string;
  providerPaymentId: string | null;

  appointmentId: string | null;

  // G6 - Payment History Enhancement
  createdAt: Date;
  purpose: PaymentPurpose;
  groupPurchaseId: string | null;
  label: string;
  refundedAmount: number;
}
export interface IMyPaymentsQuery {
  page?: string;
  limit?: string;

  status?: "PENDING" | "PAID" | "FAILED" | "REFUNDED" | "PARTIALLY_REFUNDED";
}

export interface IMyPaymentItem {
  id: string;
  amount: number;
  currency: string;
  paymentStatus: string;
  provider: string;
  providerPaymentId: string | null;
  appointmentId: string | null;
}

export interface IRefundPaymentPayload {
  amount: number;
  reason: string;
}

export interface IRefundPaymentResponse {
  paymentId: string;

  refundId: string;
  refundStatus: "SUCCEEDED";
  amount: number;
}

export interface ICreateGroupPurchaseStripeIntentPayload {
  purchaseId: string;
}

export interface ICreateGroupPurchaseStripeIntentResponse {
  paymentId: string;
  purchaseId: string;
  amount: number;
  currency: string;
  paymentStatus: "PENDING";
  clientSecret: string;
}
