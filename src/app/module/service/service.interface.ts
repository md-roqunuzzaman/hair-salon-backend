import { ServiceStatus } from "../../../../generated/prisma/client.js";

export interface ICreateServicePayload {
  name: string;
  description?: string;
  price: number;
  durationMinutes: number;
  branchIds: string[];
  imageObjectKeys: string[];
}

export interface IUpdateServicePayload {
  name?: string;
  description?: string;
  price?: number;
  durationMinutes?: number;
}

export interface IUpdateServiceStatusPayload {
  status: ServiceStatus;
}

export interface IAssignServiceBranchesPayload {
  branchIds: string[];
}
