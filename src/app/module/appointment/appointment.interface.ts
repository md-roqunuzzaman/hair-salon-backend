export interface ICreatePayNowAppointmentPayload {
  branchId: string;
  serviceId?: string | null;
  packageId?: string | null;
  staffId: string;
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
  staffId: string;
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

  bookingMethod: "PAY_NOW" | "RESERVE_NOW";

  appointmentStatus:
    | "PENDING_PAYMENT"
    | "RESERVED"
    | "CONFIRMED"
    | "COMPLETED"
    | "CANCELLED"
    | "NO_SHOW"
    | "EXPIRED";

  paymentStatus:
    | "UNPAID"
    | "PENDING"
    | "PAID"
    | "FAILED"
    | "REFUNDED"
    | "PARTIALLY_REFUNDED";

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

  bookingMethod: "PAY_NOW" | "RESERVE_NOW";

  appointmentStatus:
    | "PENDING_PAYMENT"
    | "RESERVED"
    | "CONFIRMED"
    | "COMPLETED"
    | "CANCELLED"
    | "NO_SHOW"
    | "EXPIRED";

  paymentStatus:
    | "UNPAID"
    | "PENDING"
    | "PAID"
    | "FAILED"
    | "REFUNDED"
    | "PARTIALLY_REFUNDED";

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
  staffId: string;
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

  bookingMethod?: "PAY_NOW" | "RESERVE_NOW";

  appointmentStatus?:
    | "PENDING_PAYMENT"
    | "RESERVED"
    | "CONFIRMED"
    | "COMPLETED"
    | "CANCELLED"
    | "NO_SHOW"
    | "EXPIRED";

  paymentStatus?:
    | "UNPAID"
    | "PENDING"
    | "PAID"
    | "FAILED"
    | "REFUNDED"
    | "PARTIALLY_REFUNDED";
}

export interface IAllAppointmentsQuery {
  page?: string;
  limit?: string;

  branchId?: string;
  staffId?: string;
  serviceId?: string;
  packageId?: string;

  bookingMethod?: "PAY_NOW" | "RESERVE_NOW";

  appointmentStatus?:
    | "PENDING_PAYMENT"
    | "RESERVED"
    | "CONFIRMED"
    | "COMPLETED"
    | "CANCELLED"
    | "NO_SHOW"
    | "EXPIRED";

  paymentStatus?:
    | "UNPAID"
    | "PENDING"
    | "PAID"
    | "FAILED"
    | "REFUNDED"
    | "PARTIALLY_REFUNDED";

  from?: string;
  to?: string;
}
