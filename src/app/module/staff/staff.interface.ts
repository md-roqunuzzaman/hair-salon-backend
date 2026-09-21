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
