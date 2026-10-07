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

export interface IAvailabilityResult {
  date: string;

  staffSelectionMode: "SELECTED" | "AUTO";

  slots: IAvailabilitySlot[];
}
