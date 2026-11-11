import {
  DayOfWeek,
  StaffUnavailabilityType,
} from "../../../../generated/prisma/enums.js";
import { Language } from "../../utils/language.js";

export interface IStaffLocale {
  roleTitle?: string;
  specialization?: string;
  description?: string;
}

export type IStaffTranslations = Partial<Record<Language, IStaffLocale>>;
export interface ICreateStaffPayload {
  name: string;
  email: string;
  phone?: string;
  roleTitle: string;
  specialization?: string;
  description?: string;
  translations?: IStaffTranslations;

  branchIds: string[];
  serviceIds: string[];
  packageIds: string[];

  avatarObjectKey?: string;
}

export interface IUpdateStaffPayload {
  name?: string;
  phone?: string;
  roleTitle?: string;
  specialization?: string;
  description?: string;
  avatarObjectKey?: string;
  translations?: IStaffTranslations;
}

export interface IUpdateStaffStatusPayload {
  status: "ACTIVE" | "INACTIVE";
}

export interface IAssignStaffBranchesPayload {
  branchIds: string[];
}

export interface IAssignStaffServicesPayload {
  serviceIds: string[];
}

export interface IAssignStaffPackagesPayload {
  packageIds: string[];
}

export interface IStaffScheduleItem {
  day: DayOfWeek;
  branchId: string;
  startTime: string;
  endTime: string;
}

export interface IUpdateStaffSchedulePayload {
  schedule: IStaffScheduleItem[];
}

export interface ICreateStaffUnavailabilityPayload {
  type: StaffUnavailabilityType;

  // Existing single-day support
  date?: string;
  startTime?: string;
  endTime?: string;

  // New multiple-day support
  startDate?: string;
  endDate?: string;
  fullDay?: boolean;

  reason?: string;
}
export interface IUpdateStaffUnavailabilityPayload {
  type?: StaffUnavailabilityType;
  date?: string;
  startTime?: string;
  endTime?: string;
  reason?: string;
}

export interface IMyStaffAppointmentsQuery {
  date?: string;

  status?:
    | "PENDING_PAYMENT"
    | "RESERVED"
    | "CONFIRMED"
    | "COMPLETED"
    | "CANCELLED"
    | "NO_SHOW"
    | "EXPIRED";

  // H01: Backend Upcoming / History filtering
  type?: "UPCOMING" | "HISTORY";

  page?: string;
  limit?: string;
}

// =====================================================
// TEMPORARY STAFF SCHEDULE OVERRIDE
// =====================================================

export interface ICreateStaffScheduleOverridePayload {
  branchId: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  endTime: string; // HH:mm
}

export interface IUpdateStaffScheduleOverridePayload {
  branchId?: string;
  date?: string; // YYYY-MM-DD
  startTime?: string; // HH:mm
  endTime?: string; // HH:mm
}

export interface IGetStaffScheduleOverridesQuery {
  branchId?: string;
  startDate?: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD
}

export interface IUpdateStaffScheduleOverridePayload {
  branchId?: string;
  date?: string; // YYYY-MM-DD
  startTime?: string; // HH:mm
  endTime?: string; // HH:mm
}
// =====================================================
// EFFECTIVE STAFF SCHEDULE
// =====================================================

export interface IEffectiveStaffSchedule {
  staffId: string;
  date: string;
  day: string;
  source: "REGULAR" | "OVERRIDE";
  hasOverride: boolean;

  schedules: {
    branchId: string;
    startTime: string;
    endTime: string;
  }[];
}
