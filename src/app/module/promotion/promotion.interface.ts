import { PromotionStatus } from "../../../../generated/prisma/enums.js";

export type IPromotionTranslations = {
  [language: string]:
    | {
        name: string;
      }
    | undefined;
};
export interface ICreatePromotionPayload {
  name: string;
  minimumTopup: number;
  bonusAmount: number;
  startAt: string;
  endAt: string;
  translations?: IPromotionTranslations;
  branchIds: string[];
  serviceIds: string[];
  packageIds: string[];
  status: PromotionStatus;

  imageObjectKey?: string;
}

export interface IUpdatePromotionPayload {
  name?: string;
  translations?: IPromotionTranslations;

  minimumTopup?: number;
  bonusAmount?: number;

  startAt?: string;
  endAt?: string;

  branchIds?: string[];
  serviceIds?: string[];
  packageIds?: string[];

  imageObjectKey?: string;
}
