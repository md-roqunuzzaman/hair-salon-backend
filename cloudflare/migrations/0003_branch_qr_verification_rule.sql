-- Preserve existing QR behaviour for all existing branch policies.
ALTER TABLE "BranchBookingPolicy" ADD COLUMN "qrVerificationRule" TEXT NOT NULL DEFAULT 'BEFORE_START_TIME';
