import { ReviewModerationStatus } from "../../../../generated/prisma/enums.js";

export interface ICreateReviewPayload {
  rating: number;
  comment?: string;
  imageObjectKeys?: string[];
}

export interface IUpdateReviewPayload {
  rating?: number;
  comment?: string;
  imageObjectKeys?: string[];
}

export interface IModerateReviewPayload {
  moderationStatus: ReviewModerationStatus;
  reason?: string;
}

export interface IReviewReplyPayload {
  reply: string;
}

export interface IGetReviewsQuery {
  page?: number;
  limit?: number;
  rating?: number;
}
