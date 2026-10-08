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
