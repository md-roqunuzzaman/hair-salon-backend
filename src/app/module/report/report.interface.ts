export interface IReportDateQuery {
  from?: string;
  to?: string;
}

export interface IBookingConversionReportQuery {
  branchId?: string;
  staffId?: string;
  serviceId?: string;
  packageId?: string;
  from?: string;
  to?: string;
}

export interface IServiceReportItem {
  serviceId: string;
  serviceName: string;
  bookingCount: number;
  completedCount: number;
  cancelledCount: number;
  noShowCount: number;
  revenue: number;
}

export interface IServiceReportResponse {
  items: IServiceReportItem[];
}

export interface IPackageReportItem {
  packageId: string;
  packageName: string;
  bookingCount: number;
  completedCount: number;
  cancelledCount: number;
  noShowCount: number;
  revenue: number;
}

export interface IPackageReportResponse {
  items: IPackageReportItem[];
}

export interface IGroupPurchaseReportItem {
  packageId: string;
  name: string;
  capacity: number;
  soldQuantity: number;
  remainingQuantity: number;
  uniqueCustomers: number;
  salesAmount: number;
  listingStatus: string;
  soldOut: boolean;
}

export interface IGroupPurchaseReportResponse {
  items: IGroupPurchaseReportItem[];
}

export interface IStaffReportQuery {
  branchId?: string;
}

export interface IStaffReportItem {
  staffId: string;
  name: string;
  assignedAppointments: number;
  completedAppointments: number;
  cancelled: number;
  noShow: number;
  averageRating: number;
}

export interface IStaffReportResponse {
  items: IStaffReportItem[];
}

export interface IPaymentReportResponse {
  stripePayments: number;
  walletPayments: number;
  refunds: number;
  netPayments: number;
}

export interface IWalletReportResponse {
  topupTotal: number;
  bonusIssued: number;
  paidBalancePurposed: number;
  bonusBalancePurposed: number;
  refunds: number;
}
