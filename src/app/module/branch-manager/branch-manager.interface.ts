export interface ICreateBranchManagerPayload {
  name: string;
  email: string;
  phone?: string;
  branchIds: string[];
}

export interface IUpdateBranchManagerBranchesPayload {
  branchIds: string[];
}

import { UserStatus } from "../../../../generated/prisma/client.js";

export interface IUpdateBranchManagerStatusPayload {
  status: UserStatus;
}
