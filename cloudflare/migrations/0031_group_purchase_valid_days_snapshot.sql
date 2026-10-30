-- Additive only. Historical validity cannot be inferred from today's package.
-- The versioned migration runner supplies the transaction and ledger insert.
ALTER TABLE "GroupPurchase" ADD COLUMN "validDaysSnapshot" INTEGER;
