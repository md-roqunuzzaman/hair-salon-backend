ALTER TABLE "BrandEmailSetting" ADD COLUMN "configurationVersion" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "BrandEmailSetting" ADD COLUMN "providerData" JSONB;
ALTER TABLE "BrandEmailSetting" ADD COLUMN "lastTestAt" TIMESTAMP(3);
ALTER TABLE "BrandEmailSetting" ADD COLUMN "lastErrorCode" TEXT;
UPDATE "BrandEmailSetting" SET "isEnabled" = false, "isVerified" = false;
