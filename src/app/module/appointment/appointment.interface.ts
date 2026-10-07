import { SalonPaymentMethod } from "../../../../generated/prisma/enums.js";

export type BookingMethodType = "PAY_NOW" | "RESERVE_NOW" | "DEPOSIT";

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

  staff: {
    id: string;
    name: string;
  };

  date: string;
  startTime: string;
  endTime: string;

  price: number;

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
  depositPercentage: number;
  depositAmount: number;
  remainingAmount: number;
  amountPaid: number;
  amountDue: number;
  qr: {
    available: boolean;
    verified: boolean;
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
}

export interface IVerifyQrResponse {
  appointmentId: string;
  appointmentStatus: "CONFIRMED";
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

  appointmentStatus?: AppointmentStatusType;

  paymentStatus?: PaymentStatusType;
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
