ALTER TABLE "BrandEmailSetting" ADD COLUMN "configurationVersion" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "BrandEmailSetting" ADD COLUMN "providerData" JSONB;
ALTER TABLE "BrandEmailSetting" ADD COLUMN "lastTestAt" DATETIME;
ALTER TABLE "BrandEmailSetting" ADD COLUMN "lastErrorCode" TEXT;
-- Prior verification did not prove DNS verification or OAuth identity.
-- Require all old merchant configurations to be explicitly tested again.
UPDATE "BrandEmailSetting" SET "isEnabled" = false, "isVerified" = false;
