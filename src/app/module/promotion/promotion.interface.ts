import { PromotionStatus } from "../../../../generated/prisma/enums.js";

export interface ICreatePromotionPayload {
  name: string;
  minimumTopup: number;
  bonusAmount: number;
  startAt: string;
  endAt: string;
  branchIds: string[];
  serviceIds: string[];
  packageIds: string[];
  status: PromotionStatus;

  imageObjectKey?: string;
}

export interface IUpdatePromotionPayload {
  name?: string;
  minimumTopup?: number;
  bonusAmount?: number;
  startAt?: string;
  endAt?: string;
  branchIds?: string[];
  serviceIds?: string[];
  packageIds?: string[];

  imageObjectKey?: string;
}
