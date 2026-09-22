import {
  DayOfWeek,
  StaffUnavailabilityType,
} from "../../../../generated/prisma/enums.js";

export interface ICreateStaffPayload {
  name: string;
  email: string;
  phone?: string;
  roleTitle: string;
  specialization?: string;
  description?: string;

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
