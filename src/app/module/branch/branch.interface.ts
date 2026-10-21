import {
  BookingMethod,
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
  qrVerificationRule: "BEFORE_START_TIME" | "BEFORE_END_TIME";

  // Merchant-configurable booking methods.
  // GROUP_PURCHASE is excluded by request validation.
  allowedBookingMethods: BookingMethod[];

  // Default 10%, configurable by merchant.
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

export interface IBranchDailySummaryQuery {
  date: string;
}

export interface IBranchDailySummaryResult {
  date: string;

  total: number;
  completed: number;
  cancelled: number;
  noShow: number;
  pending: number;
  expired: number;

  statusBreakdown: {
    pendingPayment: number;
    reserved: number;
    confirmed: number;
    completed: number;
    cancelled: number;
    noShow: number;
    expired: number;
  };

  revenue: number;
  averageTicket: number;
}

export interface IBranchDailySeriesQuery {
  start: string;
  end: string;
}

export interface IBranchDailySeriesItem {
  date: string;
  count: number;
}

export interface IBranchDailySeriesResult {
  items: IBranchDailySeriesItem[];
}

export interface IBranchStaffOutputQuery {
  start: string;
  end: string;
}

export interface IBranchStaffOutputItem {
  staffId: string;
  staffName: string;

  appointmentCount: number;
  completedCount: number;

  revenue: number;
  averageRating: number | null;
}

export interface IBranchStaffOutputResult {
  items: IBranchStaffOutputItem[];
}
