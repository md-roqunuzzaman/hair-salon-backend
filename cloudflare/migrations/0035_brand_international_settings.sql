-- Add settings with the existing Hong Kong defaults; preserve all other data.
ALTER TABLE "Brand" ADD COLUMN "countryCode" TEXT NOT NULL DEFAULT 'HK';
ALTER TABLE "Brand" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'HKD';
ALTER TABLE "Brand" ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'Asia/Hong_Kong';
