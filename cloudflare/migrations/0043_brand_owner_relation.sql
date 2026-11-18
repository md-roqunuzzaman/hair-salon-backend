-- Existing owners are unknown: retain NULL rather than assigning an account.
-- SUPER_ADMIN is a Prisma enum value; SQLite stores Role as TEXT, so it needs
-- client generation rather than PostgreSQL ALTER TYPE syntax here.
ALTER TABLE "Brand" ADD COLUMN "ownerId" TEXT
  CONSTRAINT "Brand_ownerId_fkey" REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Brand_ownerId_idx" ON "Brand"("ownerId");
