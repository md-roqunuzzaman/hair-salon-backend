import { Role, UserStatus } from "../../../../generated/prisma/client.js";

export interface IAdminUserQuery {
  page?: number;
  limit?: number;
  role?: Role;
  status?: UserStatus;
  q?: string;
}

export interface IUpdateAdminUserStatusPayload {
  status: UserStatus;
}
