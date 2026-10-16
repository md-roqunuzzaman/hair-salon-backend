export interface IAvailabilityQuery {
  branchId: string;

  serviceId?: string;
  packageId?: string;

  // Optional preferred staff
  staffId?: string;

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

  // Selected staff or auto-selected candidate
  staffId: string;

  available: boolean;

  capacity: {
    maxBookingsPerHour: number;
    used: number;
    remaining: number;
  };

  staffSelectionMode: "SELECTED" | "AUTO";
}

// =====================================================
// AVAILABILITY RESPONSE
// =====================================================

export interface IAvailabilityResult {
  date: string;

  staffSelectionMode: "SELECTED" | "AUTO";

  slots: IAvailabilitySlot[];

  // Only returned when slots are empty
  unavailableReason?: AvailabilityUnavailableReason;
}
