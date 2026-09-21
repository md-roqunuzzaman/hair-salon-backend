import {
  DayOfWeek,
  ReserveExpiryRule,
} from "../../../../generated/prisma/enums.js";

export interface ICreateBranchPayload {
  name: string;
  address: string;
  phone?: string;
  description?: string;
  imageObjectKey?: string;
}

export interface IUpdateBranchPayload {
  name?: string;
  address?: string;
  phone?: string;
  description?: string;
  imageObjectKey?: string;
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
}
