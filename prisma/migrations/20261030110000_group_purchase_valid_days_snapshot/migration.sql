BEGIN;
-- Keep historical purchases NULL; the current package validity is not proof
-- of the validity promised at the time of an older purchase.
ALTER TABLE "GroupPurchase" ADD COLUMN "validDaysSnapshot" INTEGER;
COMMIT;
