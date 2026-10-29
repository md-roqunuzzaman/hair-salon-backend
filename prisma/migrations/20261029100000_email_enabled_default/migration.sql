BEGIN;
-- Change the default only. Never rewrite existing merchant enablement choices.
ALTER TABLE "BrandEmailSetting" ALTER COLUMN "isEnabled" SET DEFAULT true;
COMMIT;
