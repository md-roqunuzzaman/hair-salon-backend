-- Add nullable ownership without rebuilding Branch or its referenced tables.
ALTER TABLE "Branch" ADD COLUMN "brandId" TEXT
  CONSTRAINT "Branch_brandId_fkey" REFERENCES "Brand" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Branch_brandId_idx" ON "Branch"("brandId");

-- The legacy runtime has one merchant. Backfill only when ownership is
-- unambiguous; never guess using the first row in a multi-brand database.
-- Zero/multiple brands leave NULLs for an explicit ownership mapping.
UPDATE "Branch"
SET "brandId" = (SELECT "id" FROM "Brand")
WHERE "brandId" IS NULL
  AND (SELECT COUNT(*) FROM "Brand") = 1;
