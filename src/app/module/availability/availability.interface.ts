// =====================================================
// STAFF PREFERENCE
// =====================================================

export type AvailabilityStaffPreference =
  | "SELECT_STAFF"
  | "AUTO_ASSIGN"
  | "NO_STAFF";

// =====================================================
// STAFF SELECTION MODE
// =====================================================

export type AvailabilityStaffSelectionMode = "SELECTED" | "AUTO" | "NO_STAFF";

// =====================================================
// AVAILABILITY QUERY
// =====================================================

export interface IAvailabilityQuery {
  branchId: string;

  serviceId?: string;
  packageId?: string;

  // Optional preferred staff
  staffId?: string;

  // Explicit booking preference
  staffPreference?: AvailabilityStaffPreference;

  // Backward compatibility
  staff?: "ANY";

  excludeAppointmentId?: string;

  date: string;
}

// =====================================================
// UNAVAILABLE REASONS
// =====================================================

export type AvailabilityUnavailableReason =
  | "DATE_IN_PAST"
  | "BOOKING_WINDOW_EXCEEDED"
  | "BRANCH_CLOSED"
  | "CAPACITY_NOT_CONFIGURED"
  | "NO_ELIGIBLE_STAFF"
  | "NO_STAFF_SCHEDULE"
  | "NO_AVAILABLE_SLOTS";

// =====================================================
// AVAILABILITY SLOT
// =====================================================

export interface IAvailabilitySlot {
  startTime: string;
  endTime: string;

  // Null only for staff-free bookings
  staffId: string | null;

  available: boolean;

  capacity: {
    maxBookingsPerHour: number;
    used: number;
    remaining: number;
  };

  staffSelectionMode: AvailabilityStaffSelectionMode;
}

// =====================================================
// AVAILABILITY RESPONSE
// =====================================================

export interface IAvailabilityResult {
  date: string;

  staffSelectionMode: AvailabilityStaffSelectionMode;

  slots: IAvailabilitySlot[];

  // Only returned when slots are empty
  unavailableReason?: AvailabilityUnavailableReason;
}
