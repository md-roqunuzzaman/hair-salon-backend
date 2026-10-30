import { PaymentPurpose } from "../../../../generated/prisma/enums.js";

// =====================================================
// 1. CREATE STRIPE PAYMENT INTENT
// =====================================================

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

// =====================================================
// 2. STRIPE WEBHOOK
// =====================================================

export interface IStripeWebhookResponse {
  received: true;
}

// =====================================================
// 3. PAYMENT DETAILS
// =====================================================

export interface IPaymentDetailsResponse {
  id: string;
  amount: number;
  currency: string;
  paymentStatus: string;
  provider: string;
  providerPaymentId: string | null;
  appointmentId: string | null;
}

// =====================================================
// 4. CUSTOMER PAYMENT HISTORY QUERY
// =====================================================

export interface IMyPaymentsQuery {
  page?: string;
  limit?: string;

  status?: "PENDING" | "PAID" | "FAILED" | "REFUNDED" | "PARTIALLY_REFUNDED";
}

// =====================================================
// 5. CUSTOMER PAYMENT HISTORY ITEM
// =====================================================

export interface IMyPaymentItem {
  id: string;

  orderNumber: string | null;

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

  // G7 - Refund Eligibility
  canRefund: boolean;
  refundBlockedReason: string | null;
}

// =====================================================
// 6. REFUND PAYMENT
// =====================================================

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

// =====================================================
// 7. GROUP PURCHASE STRIPE PAYMENT INTENT
// =====================================================

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
