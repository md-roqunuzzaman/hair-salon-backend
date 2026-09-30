export interface IDashboardQuery {
  from?: string;
  to?: string;
}

export interface IBranchDashboardParams {
  branchId: string;
  userId: string;
  role: string;
  query: IDashboardQuery;
}
