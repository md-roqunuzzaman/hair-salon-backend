import {
  ListingStatus,
  PackageStatus,
  PackageType,
} from "../../../../generated/prisma/client.js";
import { Language } from "../../utils/language.js";

export interface IPackageLocale {
  name?: string;
  description?: string;
}

export type IPackageTranslations = Partial<Record<Language, IPackageLocale>>;
export interface ICreatePackagePayload {
  type: PackageType;
  name: string;
  description?: string;
  translations?: IPackageTranslations;

  serviceIds: string[];

  regularPrice: number;
  packagePrice: number;
  durationMinutes: number;

  branchIds: string[];

  imageObjectKeys: string[]; // Required

  listingStatus: ListingStatus;

  // GROUP_PURCHASE_PACKAGE only
  capacity?: number;
  purchaseLimitPerCustomer?: number;
  salesStartAt?: string;
  salesEndAt?: string;
}

export interface IUpdatePackagePayload {
  name?: string;
  description?: string;

  regularPrice?: number;
  packagePrice?: number;
  durationMinutes?: number;
  imageObjectKeys?: string[];

  capacity?: number;
  purchaseLimitPerCustomer?: number;
  salesStartAt?: string;
  salesEndAt?: string;
  translations?: IPackageTranslations;
}

export interface IUpdatePackageStatusPayload {
  status: PackageStatus;
}

export interface IUpdatePackageListingPayload {
  listingStatus: ListingStatus;
}

export interface IAssignPackageBranchesPayload {
  branchIds: string[];
}
