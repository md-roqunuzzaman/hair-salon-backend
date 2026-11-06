-- Nullable snapshots: historical values are deliberately not guessed.
ALTER TABLE "Appointment" ADD COLUMN "timezone" TEXT;
ALTER TABLE "GroupPurchase" ADD COLUMN "currency" TEXT;
