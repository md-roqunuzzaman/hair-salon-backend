import { ServiceStatus } from "../../../../generated/prisma/client.js";

// =====================================================
// SERVICE TRANSLATIONS
// =====================================================

export interface IServiceLocale {
  name?: string;
  description?: string | null;
}

export interface IServiceTranslations {
  en?: IServiceLocale;
  "zh-CN"?: IServiceLocale;
  "zh-HK"?: IServiceLocale;
}

// =====================================================
// CREATE SERVICE
// =====================================================

export interface ICreateServicePayload {
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

export interface IUpdateServicePayload {
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
