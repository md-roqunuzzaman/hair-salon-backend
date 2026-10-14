import { ServiceStatus } from "../../../../generated/prisma/client.js";

// =====================================================
// SERVICE TRANSLATIONS
// =====================================================
export interface IServiceLocale {
  name?: string;
  description?: string | null;

  processSteps?: string[];
  bookingNotes?: string[];
}

export interface IServiceTranslations {
  en?: IServiceLocale;
  "zh-CN"?: IServiceLocale;
  "zh-HK"?: IServiceLocale;
}

// =====================================================
// SERVICE DISPLAY FIELDS
// =====================================================

export interface IServiceDisplayFields {
  isPopular?: boolean;
  processSteps?: string[];
  bookingNotes?: string[];
}

// =====================================================
// CREATE SERVICE
// =====================================================

export interface ICreateServicePayload extends IServiceDisplayFields {
  name: string;
  description?: string;
  price: number;
  durationMinutes: number;
  branchIds: string[];
  imageObjectKeys?: string[];

  translations?: IServiceTranslations;
}

// =====================================================
// UPDATE SERVICE
// =====================================================

export interface IUpdateServicePayload extends IServiceDisplayFields {
  name?: string;
  description?: string;
  price?: number;
  imageObjectKeys?: string[];
  durationMinutes?: number;

  translations?: IServiceTranslations;
}

// =====================================================
// STATUS
// =====================================================

export interface IUpdateServiceStatusPayload {
  status: ServiceStatus;
}

// =====================================================
// BRANCH ASSIGNMENT
// =====================================================

export interface IAssignServiceBranchesPayload {
  branchIds: string[];
}
