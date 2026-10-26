import type {
  BannerScope,
  BannerStatus,
  Role,
} from "../../../../generated/prisma/client.js";

export interface IBannerActor {
  userId: string;
  role: Role;
  brandId: string;
}

export interface ICreateBannerPayload {
  title: string;
  description?: string | null;

  scope?: BannerScope;
  branchIds?: string[];

  status?: BannerStatus;

  startAt?: string | null;
  endAt?: string | null;

  sortOrder?: number;
}

export interface IAdminBannerQuery {
  page?: number;
  limit?: number;
  search?: string;
  status?: BannerStatus;
  scope?: BannerScope;
  branchId?: string;
  sortBy?: "createdAt" | "updatedAt" | "sortOrder" | "startAt" | "endAt";
  sortOrder?: "asc" | "desc";
}

export interface IUpdateBannerPayload {
  title?: string;
  description?: string | null;
  scope?: BannerScope;
  branchIds?: string[];
  startAt?: string | null;
  endAt?: string | null;
  sortOrder?: number;
}

export interface IGetActiveBannersQuery {
  branchId: string;
  page?: number;
  limit?: number;
}

export interface IUpdateBannerMediaOrderPayload {
  mediaIds: string[];
}
