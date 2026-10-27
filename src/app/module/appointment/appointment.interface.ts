import { SalonPaymentMethod } from "../../../../generated/prisma/enums.js";
import { PaymentDisplayStatus } from "../../utils/getPaymentDisplayStatus.js";

export type BookingMethodType =
  | "PAY_NOW"
  | "RESERVE_NOW"
  | "DEPOSIT"
  | "GROUP_PURCHASE";

export type AppointmentStatusType =
  | "PENDING_PAYMENT"
  | "RESERVED"
  | "CONFIRMED"
  | "COMPLETED"
  | "CANCELLED"
  | "NO_SHOW"
  | "EXPIRED";

export type PaymentStatusType =
  | "UNPAID"
  | "PENDING"
  | "PARTIALLY_PAID"
  | "PAID"
  | "FAILED"
  | "REFUNDED"
  | "PARTIALLY_REFUNDED";

export interface ICreatePayNowAppointmentPayload {
  branchId: string;

  serviceId?: string | null;
  packageId?: string | null;

  // Optional:
  // absent/null = AUTO / ANY STAFF
  staffId?: string | null;

  date: string;
  startTime: string;
}

export interface IPayNowAppointmentResponse {
  appointmentId: string;
  orderNumber: string;
  bookingMethod: "PAY_NOW";
  appointmentStatus: "PENDING_PAYMENT";
  paymentStatus: "PENDING";
  holdExpiresAt: Date;
  qrAvailable: false;
}

export interface ICreateReserveAppointmentPayload {
  branchId: string;

  serviceId?: string | null;
  packageId?: string | null;

  // Optional:
  // absent/null = AUTO / ANY STAFF
  staffId?: string | null;

  date: string;
  startTime: string;
}

export interface IReserveAppointmentResponse {
  appointmentId: string;
  orderNumber: string;
  bookingMethod: "RESERVE_NOW";
  appointmentStatus: "RESERVED";
  paymentStatus: "UNPAID";

  qr: {
    available: true;
    token: string;
  };
}

export type AppointmentListType = "UPCOMING" | "HISTORY";

export interface IMyAppointmentsQuery {
  type: AppointmentListType;
  page?: string;
  limit?: string;
}

export interface IMyAppointmentItem {
  id: string;
  paymentDisplayStatus: PaymentDisplayStatus;

  bookingMethod: BookingMethodType;

  appointmentStatus: AppointmentStatusType;

  paymentStatus: PaymentStatusType;

  branch: {
    id: string;
    name: string;
  };

  service: {
    id: string;
    name: string;
  } | null;

  // NEW: Package booking + multilingual name
  package: {
    id: string;
    name: string;
  } | null;

  staff: {
    id: string;
    name: string;
  };

  date: string;
  startTime: string;
  endTime: string;

  price: number;

  // Deposit/payment summary
  depositPercentage: number;
  depositAmount: number | null;
  remainingAmount: number;

  amountPaid: number;
  amountDue: number;

  qrAvailable: boolean;
}

export interface IMyAppointmentsResult {
  items: IMyAppointmentItem[];

  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

export interface IAppointmentDetails {
  id: string;
  orderNumber: string | null;
  paymentDisplayStatus: PaymentDisplayStatus;
  bookingMethod: BookingMethodType;
  appointmentStatus: AppointmentStatusType;
  paymentStatus: PaymentStatusType;

  branch: {
    id: string;
    name: string;
  };

  service: {
    id: string;
    name: string;
    durationMinutes: number;
  } | null;

  package: {
    id: string;
    name: string;
    durationMinutes: number;
  } | null;

  staff: {
    id: string;
    name: string;
  };

  date: string;
  startTime: string;
  endTime: string;

  price: number;
  currency: string;

  // =====================================================
  // G8 — DEPOSIT & REMAINING BALANCE
  // =====================================================

  depositPercentage: number;

  // Null for non-DEPOSIT bookings
  depositAmount: number | null;

  // Current outstanding balance; 0 when fully paid
  remainingAmount: number;

  amountPaid: number;
  amountDue: number;

  payment: {
    method: SalonPaymentMethod | null;
    provider: string | null;
    paidAt: Date | null;
  };

  qr: {
    available: boolean;
    verified: boolean;
    verifiedAt: Date | null;
    verifiedBy: {
      id: string;
      name: string;
    } | null;
  };

  review: {
    allowed: boolean;
    submitted: boolean;
  };
}

export interface ICancelAppointmentPayload {
  reason: string;
}

export interface ICancelAppointmentResponse {
  appointmentId: string;
  appointmentStatus: "CANCELLED";
  refundStatus: "NOT_REQUIRED";

  groupPurchase?: {
    purchaseId: string;
    purchasedQuantity: number;
    redeemedQuantity: number;
    remainingQuantity: number;
  };
}

export interface IRescheduleAppointmentPayload {
  date: string;
  startTime: string;

  // Optional.
  // Service layer later decides:
  // current staff / auto-assigned staff
  staffId?: string | null;
}
export interface IRescheduleAppointmentResponse {
  appointmentId: string;
  date: string;
  startTime: string;
  endTime: string;
}

export interface IAppointmentQrResponse {
  available: boolean;
  qrValue: string | null;
}

export interface IVerifyQrPayload {
  qrToken: string;
  branchId: string;
  paymentMethod?: SalonPaymentMethod;
}

export interface IVerifyQrResponse {
  appointmentId: string;

  appointmentStatus: "CONFIRMED";

  paymentStatus: PaymentStatusType;

  qrVerifiedAt: Date;

  verifiedBy: {
    id: string;
    name: string;
  };
}
export interface ICompleteAppointmentPayload {
  notes?: string;
}

export interface ICompleteAppointmentResponse {
  appointmentId: string;
  appointmentStatus: "COMPLETED";
  completedAt: Date;
  reviewEnabled: true;
}

export interface IMarkNoShowPayload {
  reason: string;
}

export interface IMarkNoShowResponse {
  appointmentId: string;
  appointmentStatus: "NO_SHOW";
}

export interface IBranchAppointmentsQuery {
  page?: string;
  limit?: string;

  date?: string;

  staffId?: string;

  bookingMethod?: BookingMethodType;

  status?: AppointmentStatusType;
  appointmentStatus?: AppointmentStatusType;

  paymentStatus?: PaymentStatusType;
}
export interface IBranchAppointmentItem {
  id: string;

  bookingMethod: BookingMethodType;
  appointmentStatus: AppointmentStatusType;
  paymentStatus: PaymentStatusType;

  customer: {
    id: string;
    name: string;
    phone: string | null;
  };

  branch: {
    id: string;
    name: string;
  };

  staff: {
    id: string;
    name: string;
  } | null;

  service: {
    id: string;
    name: string;
  } | null;

  package: {
    id: string;
    name: string;
  } | null;

  date: string;
  startTime: string;
  endTime: string;

  durationMinutes: number;

  price: number;
  currency: string;

  // =====================================================
  // G3 REVIEW STATUS
  // =====================================================

  reviewed: boolean;

  // =====================================================
  // G3 QR VERIFICATION
  // =====================================================

  qrToken: string | null;

  qrVerifiedAt: Date | null;

  qrVerifiedBy: {
    id: string;
    name: string;
  } | null;
}

export interface IBranchAppointmentsResult {
  items: IBranchAppointmentItem[];

  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

export interface IAllAppointmentsQuery {
  page?: string;
  limit?: string;

  branchId?: string;
  staffId?: string;
  serviceId?: string;
  packageId?: string;

  bookingMethod?: BookingMethodType;

  appointmentStatus?: AppointmentStatusType;

  paymentStatus?: PaymentStatusType;

  from?: string;
  to?: string;
}

export interface ICreateDepositAppointmentPayload {
  branchId: string;

  serviceId?: string;
  packageId?: string;

  // Optional:
  // absent/null = AUTO / ANY STAFF
  staffId?: string | null;

  date: string;
  startTime: string;
}

export interface IDepositAppointmentResponse {
  appointmentId: string;
  orderNumber: string;
  bookingMethod: "DEPOSIT";

  appointmentStatus: "PENDING_PAYMENT";

  paymentStatus: "PENDING";

  price: number;

  depositPercentage: number;

  depositAmount: number;

  remainingAmount: number;

  holdExpiresAt: Date;

  qrAvailable: false;
}

export type TRecordRemainingPayment = {
  paymentMethod: SalonPaymentMethod;
};
