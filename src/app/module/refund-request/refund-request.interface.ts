import { RefundRequestStatus } from "../../../../generated/prisma/enums.js";

export interface ICreateRefundRequestPayload {
  paymentId: string;
  reason: string;
}

export interface ICreateRefundRequestResponse {
  id: string;
  paymentId: string;
  amount: number;
  currency: string;
  status: "PENDING";
  createdAt: Date;
}
export interface IGetRefundRequestsQuery {
  page?: number;
  limit?: number;
  status?: RefundRequestStatus;
}
export interface IReviewRefundRequestPayload {
  decision: "APPROVE" | "REJECT";
  reviewNote?: string;
}
