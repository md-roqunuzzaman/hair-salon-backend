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
  date: string;
  startTime: string;
  endTime: string;
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

  page?: string;
  limit?: string;
}
