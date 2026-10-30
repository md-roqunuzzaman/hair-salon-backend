-- Additive only: legacy requests/refunds/ledger records remain unchanged.
ALTER TABLE "WalletTransaction" ADD COLUMN "paymentId" TEXT REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WalletTransaction" ADD COLUMN "ledgerKey" TEXT;
CREATE UNIQUE INDEX "WalletTransaction_ledgerKey_key" ON "WalletTransaction"("ledgerKey");
CREATE INDEX "WalletTransaction_paymentId_idx" ON "WalletTransaction"("paymentId");
CREATE TABLE "RefundAllocation" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "refundRequestId" TEXT NOT NULL,
 "paymentId" TEXT NOT NULL,
 "refundId" TEXT,
 "amount" BIGINT NOT NULL CHECK (typeof("amount") = 'integer' AND "amount" > 0 AND "amount" <= 9999999999),
 "provider" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'RESERVED' CHECK ("status" IN ('RESERVED','PROCESSING','SUCCEEDED','FAILED','CANCELLED')),
 "idempotencyKey" TEXT NOT NULL,
 "submittedAt" DATETIME,
 "lastErrorCode" TEXT,
 "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" DATETIME NOT NULL,
 CONSTRAINT "RefundAllocation_refundRequestId_fkey" FOREIGN KEY ("refundRequestId") REFERENCES "RefundRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "RefundAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "RefundAllocation_refundId_fkey" FOREIGN KEY ("refundId") REFERENCES "Refund"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "RefundAllocation_refundId_key" ON "RefundAllocation"("refundId");
CREATE UNIQUE INDEX "RefundAllocation_idempotencyKey_key" ON "RefundAllocation"("idempotencyKey");
CREATE UNIQUE INDEX "RefundAllocation_refundRequestId_paymentId_key" ON "RefundAllocation"("refundRequestId","paymentId");
CREATE INDEX "RefundAllocation_paymentId_status_idx" ON "RefundAllocation"("paymentId","status");
CREATE INDEX "RefundAllocation_status_idx" ON "RefundAllocation"("status");
