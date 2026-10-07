import { DayOfWeek } from "../../../../generated/prisma/client.js";

export interface IHourlyCapacityItem {
  id: string;
  day: DayOfWeek;
  maxBookingsPerHour: number;
}

export interface IGetBranchHourlyCapacityResponse {
  branchId: string;
  capacities: IHourlyCapacityItem[];
}

export interface IHourlyCapacityInput {
  day: DayOfWeek;
  maxBookingsPerHour: number;
}

export interface IUpdateBranchHourlyCapacityPayload {
  capacities: IHourlyCapacityInput[];
}
