import {
  DayOfWeek,
  ReserveExpiryRule,
} from "../../../../generated/prisma/enums.js";
import { Language } from "../../utils/language.js";

export interface ICreateBranchPayload {
  name: string;
  address: string;
  phone?: string;
  description?: string;
  imageObjectKey?: string;
  translations?: IBranchTranslations;
}

export interface IUpdateBranchPayload {
  name?: string;
  address?: string;
  phone?: string;
  description?: string;
  imageObjectKey?: string;
  translations?: IBranchTranslations;
}

export interface IUpdateBranchStatusPayload {
  status: "ACTIVE" | "INACTIVE";
}

export interface IBusinessHour {
  day: DayOfWeek;
  isClosed: boolean;
  openTime?: string | null;
  closeTime?: string | null;
}

export interface IUpdateBusinessHoursPayload {
  hours: IBusinessHour[];
}

export interface IUpdateBookingPolicyPayload {
  slotIntervalMinutes: number;

  minimumBookingNoticeMinutes: number;

  maximumAdvanceBookingDays: number;

  cancellationCutoffHours: number;

  rescheduleCutoffHours: number;

  reserveExpiryRule: ReserveExpiryRule;

  // Deposit is always enabled.
  // Only the percentage can be configured.
  depositPercentage: number;
}

export interface ICustomerOperationalSearchQuery {
  q: string;
}

export interface ICustomerOperationalSearchItem {
  id: string;
  name: string;
  phone: string | null;
}

export interface ICustomerOperationalSearchResponse {
  items: ICustomerOperationalSearchItem[];
}

export interface IBranchLocale {
  name?: string;
  address?: string;
  description?: string;
}

export type IBranchTranslations = Partial<Record<Language, IBranchLocale>>;
