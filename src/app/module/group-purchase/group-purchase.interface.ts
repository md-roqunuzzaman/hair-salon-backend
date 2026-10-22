export interface ICreateGroupPurchasePayload {
  packageId: string;
  quantity: number;

  purchaseFlow?: "BUY_NOW_BOOK_LATER" | "BUY_NOW_BOOK_NOW";

  // Required for BUY_NOW_BOOK_NOW
  bookingMethod?: "PAY_NOW" | "DEPOSIT" | "RESERVE_NOW";

  branchId?: string;
  staffId?: string | null;

  date?: string;
  startTime?: string;
}
