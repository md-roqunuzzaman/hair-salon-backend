export interface IAvailabilityQuery {
  branchId: string;
  serviceId?: string;
  packageId?: string;
  staffId?: string;
  staff?: "ANY";
  date: string;
}

export interface IAvailabilitySlot {
  startTime: string;
  endTime: string;
  staffId: string;
  available: boolean;
}

export interface IAvailabilityResult {
  date: string;
  slots: IAvailabilitySlot[];
}
