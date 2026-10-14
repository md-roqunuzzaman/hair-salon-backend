import {
  ListingStatus,
  PackageStatus,
  PackageType,
} from "../../../../generated/prisma/client.js";

import { Language } from "../../utils/language.js";

// =====================================================
// MULTILINGUAL PACKAGE FIELDS
// =====================================================

export interface IPackageLocale {
  name?: string;

  description?: string;

  applicableFor?: string[];

  purchaseNotice?: string[];

  howToUse?: string[];
}

export type IPackageTranslations = Partial<Record<Language, IPackageLocale>>;

// =====================================================
// PACKAGE DISPLAY FIELDS
// =====================================================

export interface IPackageDisplayFields {
  validDays?: number | null;

  applicableFor?: string[];

  purchaseNotice?: string[];

  howToUse?: string[];
}

// =====================================================
// CREATE PACKAGE
// =====================================================

export interface ICreatePackagePayload extends IPackageDisplayFields {
  type: PackageType;

  name: string;

  description?: string;

  translations?: IPackageTranslations;

  serviceIds: string[];

  regularPrice: number;

  packagePrice: number;

  durationMinutes: number;

  branchIds: string[];

  imageObjectKeys?: string[]; // optional

  listingStatus: ListingStatus;

  // GROUP_PURCHASE_PACKAGE only

  capacity?: number;

  purchaseLimitPerCustomer?: number;

  salesStartAt?: string;

  salesEndAt?: string;
}

// =====================================================
// UPDATE PACKAGE
// =====================================================

export interface IUpdatePackagePayload extends IPackageDisplayFields {
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

// =====================================================
// UPDATE PACKAGE STATUS
// =====================================================

export interface IUpdatePackageStatusPayload {
  status: PackageStatus;
}

// =====================================================
// UPDATE PACKAGE LISTING
// =====================================================

export interface IUpdatePackageListingPayload {
  listingStatus: ListingStatus;
}

// =====================================================
// ASSIGN PACKAGE TO BRANCHES
// =====================================================

export interface IAssignPackageBranchesPayload {
  branchIds: string[];
}
