export interface ICreateGroupPurchasePayload {
  packageId: string;
  quantity: number;

  purchaseFlow?: "BUY_NOW_BOOK_LATER" | "DIRECT_BOOK";

  // Required for DIRECT_BOOK
  bookingMethod?: "PAY_NOW" | "DEPOSIT" | "RESERVE_NOW";

  branchId?: string;
  staffId?: string | null;

  date?: string;
  startTime?: string;
}
