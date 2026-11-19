-- Match the current Prisma schema without rewriting v44 or inventing limits.
-- Existing assignments preserve every field and receive an unknown (NULL) limit.
ALTER TABLE "BrandSubscriptionAddon" ADD COLUMN "branchLimit" INTEGER;
