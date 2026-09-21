import {
  ListingStatus,
  PackageStatus,
  PackageType,
} from "../../../../generated/prisma/client.js";

export interface ICreatePackagePayload {
  type: PackageType;
  name: string;
  description?: string;

  serviceIds: string[];

  regularPrice: number;
  packagePrice: number;
  durationMinutes: number;

  branchIds: string[];

  imageObjectKeys: string[];

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

  capacity?: number;
  purchaseLimitPerCustomer?: number;
  salesStartAt?: string;
  salesEndAt?: string;
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
