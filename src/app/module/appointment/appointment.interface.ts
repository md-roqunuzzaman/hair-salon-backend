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
