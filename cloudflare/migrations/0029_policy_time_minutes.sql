-- One-time additive upgrade under the existing atomic migration runner.
-- Preserve real thresholds and historical snapshots; new API units are minutes.
CREATE TABLE "_PolicyMinuteConversionGuard" (valid INTEGER NOT NULL CHECK (valid = 1));
INSERT INTO "_PolicyMinuteConversionGuard" SELECT 0 WHERE EXISTS (
 SELECT 1 FROM "BranchCancellationPolicy", json_each("refundTiers") AS tier WHERE json_type(tier.value, '$.minimumHoursBefore') IS NOT NULL AND (
  json_type(tier.value, '$.minimumHoursBefore') NOT IN ('integer','real') OR json_extract(tier.value, '$.minimumHoursBefore') < 0 OR
  json_extract(tier.value, '$.minimumHoursBefore') * 60 > 9007199254740991 OR
  json_extract(tier.value, '$.minimumHoursBefore') * 60 != round(json_extract(tier.value, '$.minimumHoursBefore') * 60) OR
  (json_type(tier.value, '$.minimumMinutesBefore') IS NOT NULL AND json_extract(tier.value, '$.minimumMinutesBefore') IS NOT json_extract(tier.value, '$.minimumHoursBefore') * 60)
 )
);
INSERT INTO "_PolicyMinuteConversionGuard" SELECT 0 WHERE EXISTS (
 SELECT 1 FROM "BranchCancellationPolicy", json_each("refundTiers") AS tier WHERE json_type(tier.value, '$.minimumHoursBeforeAppointment') IS NOT NULL AND (
  json_type(tier.value, '$.minimumHoursBeforeAppointment') NOT IN ('integer','real') OR json_extract(tier.value, '$.minimumHoursBeforeAppointment') < 0 OR
  json_extract(tier.value, '$.minimumHoursBeforeAppointment') * 60 > 9007199254740991 OR
  json_extract(tier.value, '$.minimumHoursBeforeAppointment') * 60 != round(json_extract(tier.value, '$.minimumHoursBeforeAppointment') * 60) OR
  (json_type(tier.value, '$.minimumMinutesBeforeAppointment') IS NOT NULL AND json_extract(tier.value, '$.minimumMinutesBeforeAppointment') IS NOT json_extract(tier.value, '$.minimumHoursBeforeAppointment') * 60)
 )
);
INSERT INTO "_PolicyMinuteConversionGuard" SELECT 0 WHERE EXISTS (
 SELECT 1 FROM "BranchCancellationPolicy", json_each("refundTiers") AS tier WHERE json_type(tier.value, '$.minimumHoursAfterPurchase') IS NOT NULL AND (
  json_type(tier.value, '$.minimumHoursAfterPurchase') NOT IN ('integer','real') OR json_extract(tier.value, '$.minimumHoursAfterPurchase') < 0 OR
  json_extract(tier.value, '$.minimumHoursAfterPurchase') * 60 > 9007199254740991 OR
  json_extract(tier.value, '$.minimumHoursAfterPurchase') * 60 != round(json_extract(tier.value, '$.minimumHoursAfterPurchase') * 60) OR
  (json_type(tier.value, '$.minimumMinutesAfterPurchase') IS NOT NULL AND json_extract(tier.value, '$.minimumMinutesAfterPurchase') IS NOT json_extract(tier.value, '$.minimumHoursAfterPurchase') * 60)
 )
);
INSERT INTO "_PolicyMinuteConversionGuard" SELECT 0 WHERE EXISTS (
 SELECT 1 FROM "GroupPurchaseRefundPolicy", json_each("refundTiers") AS tier WHERE json_type(tier.value, '$.minimumHoursBefore') IS NOT NULL AND (
  json_type(tier.value, '$.minimumHoursBefore') NOT IN ('integer','real') OR json_extract(tier.value, '$.minimumHoursBefore') < 0 OR
  json_extract(tier.value, '$.minimumHoursBefore') * 60 > 9007199254740991 OR
  json_extract(tier.value, '$.minimumHoursBefore') * 60 != round(json_extract(tier.value, '$.minimumHoursBefore') * 60) OR
  (json_type(tier.value, '$.minimumMinutesBefore') IS NOT NULL AND json_extract(tier.value, '$.minimumMinutesBefore') IS NOT json_extract(tier.value, '$.minimumHoursBefore') * 60)
 )
);
INSERT INTO "_PolicyMinuteConversionGuard" SELECT 0 WHERE EXISTS (
 SELECT 1 FROM "GroupPurchaseRefundPolicy", json_each("refundTiers") AS tier WHERE json_type(tier.value, '$.minimumHoursBeforeAppointment') IS NOT NULL AND (
  json_type(tier.value, '$.minimumHoursBeforeAppointment') NOT IN ('integer','real') OR json_extract(tier.value, '$.minimumHoursBeforeAppointment') < 0 OR
  json_extract(tier.value, '$.minimumHoursBeforeAppointment') * 60 > 9007199254740991 OR
  json_extract(tier.value, '$.minimumHoursBeforeAppointment') * 60 != round(json_extract(tier.value, '$.minimumHoursBeforeAppointment') * 60) OR
  (json_type(tier.value, '$.minimumMinutesBeforeAppointment') IS NOT NULL AND json_extract(tier.value, '$.minimumMinutesBeforeAppointment') IS NOT json_extract(tier.value, '$.minimumHoursBeforeAppointment') * 60)
 )
);
INSERT INTO "_PolicyMinuteConversionGuard" SELECT 0 WHERE EXISTS (
 SELECT 1 FROM "GroupPurchaseRefundPolicy", json_each("refundTiers") AS tier WHERE json_type(tier.value, '$.minimumHoursAfterPurchase') IS NOT NULL AND (
  json_type(tier.value, '$.minimumHoursAfterPurchase') NOT IN ('integer','real') OR json_extract(tier.value, '$.minimumHoursAfterPurchase') < 0 OR
  json_extract(tier.value, '$.minimumHoursAfterPurchase') * 60 > 9007199254740991 OR
  json_extract(tier.value, '$.minimumHoursAfterPurchase') * 60 != round(json_extract(tier.value, '$.minimumHoursAfterPurchase') * 60) OR
  (json_type(tier.value, '$.minimumMinutesAfterPurchase') IS NOT NULL AND json_extract(tier.value, '$.minimumMinutesAfterPurchase') IS NOT json_extract(tier.value, '$.minimumHoursAfterPurchase') * 60)
 )
);
DROP TABLE "_PolicyMinuteConversionGuard";
ALTER TABLE "BranchBookingPolicy" ADD COLUMN "cancellationCutoffMinutes" INTEGER NOT NULL DEFAULT 720 CHECK ("cancellationCutoffMinutes" BETWEEN 0 AND 2147483647);
UPDATE "BranchBookingPolicy" SET "cancellationCutoffMinutes" = "cancellationCutoffHours" * 60;
ALTER TABLE "BranchBookingPolicy" DROP COLUMN "cancellationCutoffHours";
ALTER TABLE "BranchBookingPolicy" ADD COLUMN "rescheduleCutoffMinutes" INTEGER NOT NULL DEFAULT 720 CHECK ("rescheduleCutoffMinutes" BETWEEN 0 AND 2147483647);
UPDATE "BranchBookingPolicy" SET "rescheduleCutoffMinutes" = "rescheduleCutoffHours" * 60;
ALTER TABLE "BranchBookingPolicy" DROP COLUMN "rescheduleCutoffHours";
ALTER TABLE "BranchCancellationPolicy" ADD COLUMN "minimumCancellationMinutes" INTEGER NOT NULL DEFAULT 120 CHECK ("minimumCancellationMinutes" BETWEEN 0 AND 2147483647);
UPDATE "BranchCancellationPolicy" SET "minimumCancellationMinutes" = "minimumCancellationHours" * 60;
ALTER TABLE "BranchCancellationPolicy" DROP COLUMN "minimumCancellationHours";
ALTER TABLE "GroupPurchaseCancellationPolicy" ADD COLUMN "minimumCancellationMinutes" INTEGER NOT NULL DEFAULT 120 CHECK ("minimumCancellationMinutes" BETWEEN 0 AND 2147483647);
UPDATE "GroupPurchaseCancellationPolicy" SET "minimumCancellationMinutes" = "minimumCancellationHours" * 60;
ALTER TABLE "GroupPurchaseCancellationPolicy" DROP COLUMN "minimumCancellationHours";
ALTER TABLE "GroupPurchaseCancellationPolicy" ADD COLUMN "restorationMinimumMinutes" INTEGER NOT NULL DEFAULT 1440 CHECK ("restorationMinimumMinutes" BETWEEN 0 AND 2147483647);
UPDATE "GroupPurchaseCancellationPolicy" SET "restorationMinimumMinutes" = "restorationMinimumHours" * 60;
ALTER TABLE "GroupPurchaseCancellationPolicy" DROP COLUMN "restorationMinimumHours";
UPDATE "BranchCancellationPolicy" SET "refundTiers" = (
 SELECT json_group_array(json(converted)) FROM (
  SELECT CASE WHEN json_type(value, '$.minimumHoursBefore') IS NOT NULL THEN json_set(json_remove(value, '$.minimumHoursBefore'), '$.minimumMinutesBefore', json_extract(value, '$.minimumHoursBefore') * 60) ELSE value END AS converted
  FROM json_each("BranchCancellationPolicy"."refundTiers") ORDER BY CAST(key AS INTEGER)
 )
) WHERE json_type("refundTiers") = 'array';
UPDATE "BranchCancellationPolicy" SET "refundTiers" = (
 SELECT json_group_array(json(converted)) FROM (
  SELECT CASE WHEN json_type(value, '$.minimumHoursBeforeAppointment') IS NOT NULL THEN json_set(json_remove(value, '$.minimumHoursBeforeAppointment'), '$.minimumMinutesBeforeAppointment', json_extract(value, '$.minimumHoursBeforeAppointment') * 60) ELSE value END AS converted
  FROM json_each("BranchCancellationPolicy"."refundTiers") ORDER BY CAST(key AS INTEGER)
 )
) WHERE json_type("refundTiers") = 'array';
UPDATE "BranchCancellationPolicy" SET "refundTiers" = (
 SELECT json_group_array(json(converted)) FROM (
  SELECT CASE WHEN json_type(value, '$.minimumHoursAfterPurchase') IS NOT NULL THEN json_set(json_remove(value, '$.minimumHoursAfterPurchase'), '$.minimumMinutesAfterPurchase', json_extract(value, '$.minimumHoursAfterPurchase') * 60) ELSE value END AS converted
  FROM json_each("BranchCancellationPolicy"."refundTiers") ORDER BY CAST(key AS INTEGER)
 )
) WHERE json_type("refundTiers") = 'array';
UPDATE "GroupPurchaseRefundPolicy" SET "refundTiers" = (
 SELECT json_group_array(json(converted)) FROM (
  SELECT CASE WHEN json_type(value, '$.minimumHoursBefore') IS NOT NULL THEN json_set(json_remove(value, '$.minimumHoursBefore'), '$.minimumMinutesBefore', json_extract(value, '$.minimumHoursBefore') * 60) ELSE value END AS converted
  FROM json_each("GroupPurchaseRefundPolicy"."refundTiers") ORDER BY CAST(key AS INTEGER)
 )
) WHERE json_type("refundTiers") = 'array';
UPDATE "GroupPurchaseRefundPolicy" SET "refundTiers" = (
 SELECT json_group_array(json(converted)) FROM (
  SELECT CASE WHEN json_type(value, '$.minimumHoursBeforeAppointment') IS NOT NULL THEN json_set(json_remove(value, '$.minimumHoursBeforeAppointment'), '$.minimumMinutesBeforeAppointment', json_extract(value, '$.minimumHoursBeforeAppointment') * 60) ELSE value END AS converted
  FROM json_each("GroupPurchaseRefundPolicy"."refundTiers") ORDER BY CAST(key AS INTEGER)
 )
) WHERE json_type("refundTiers") = 'array';
UPDATE "GroupPurchaseRefundPolicy" SET "refundTiers" = (
 SELECT json_group_array(json(converted)) FROM (
  SELECT CASE WHEN json_type(value, '$.minimumHoursAfterPurchase') IS NOT NULL THEN json_set(json_remove(value, '$.minimumHoursAfterPurchase'), '$.minimumMinutesAfterPurchase', json_extract(value, '$.minimumHoursAfterPurchase') * 60) ELSE value END AS converted
  FROM json_each("GroupPurchaseRefundPolicy"."refundTiers") ORDER BY CAST(key AS INTEGER)
 )
) WHERE json_type("refundTiers") = 'array';
