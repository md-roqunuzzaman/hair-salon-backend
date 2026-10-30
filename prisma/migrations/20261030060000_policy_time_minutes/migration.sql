BEGIN;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM "BranchBookingPolicy" WHERE "cancellationCutoffHours" < 0 OR "cancellationCutoffHours"::bigint * 60 > 2147483647) THEN
  RAISE EXCEPTION 'Policy minute conversion exceeds supported integer range';
 END IF;
END $$;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM "BranchBookingPolicy" WHERE "rescheduleCutoffHours" < 0 OR "rescheduleCutoffHours"::bigint * 60 > 2147483647) THEN
  RAISE EXCEPTION 'Policy minute conversion exceeds supported integer range';
 END IF;
END $$;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM "BranchCancellationPolicy" WHERE "minimumCancellationHours" < 0 OR "minimumCancellationHours"::bigint * 60 > 2147483647) THEN
  RAISE EXCEPTION 'Policy minute conversion exceeds supported integer range';
 END IF;
END $$;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM "GroupPurchaseCancellationPolicy" WHERE "minimumCancellationHours" < 0 OR "minimumCancellationHours"::bigint * 60 > 2147483647) THEN
  RAISE EXCEPTION 'Policy minute conversion exceeds supported integer range';
 END IF;
END $$;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM "GroupPurchaseCancellationPolicy" WHERE "restorationMinimumHours" < 0 OR "restorationMinimumHours"::bigint * 60 > 2147483647) THEN
  RAISE EXCEPTION 'Policy minute conversion exceeds supported integer range';
 END IF;
END $$;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM "BranchCancellationPolicy", jsonb_array_elements("refundTiers"::jsonb) AS tier
  WHERE tier ? 'minimumHoursBefore' AND (jsonb_typeof(tier->'minimumHoursBefore') != 'number' OR
   (tier->>'minimumHoursBefore')::numeric < 0 OR (tier->>'minimumHoursBefore')::numeric * 60 > 9007199254740991 OR
   (tier->>'minimumHoursBefore')::numeric * 60 != round((tier->>'minimumHoursBefore')::numeric * 60) OR
   (tier ? 'minimumMinutesBefore' AND (tier->'minimumMinutesBefore') IS DISTINCT FROM to_jsonb((tier->>'minimumHoursBefore')::numeric * 60)))) THEN
  RAISE EXCEPTION 'Invalid or conflicting policy time units';
 END IF;
END $$;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM "BranchCancellationPolicy", jsonb_array_elements("refundTiers"::jsonb) AS tier
  WHERE tier ? 'minimumHoursBeforeAppointment' AND (jsonb_typeof(tier->'minimumHoursBeforeAppointment') != 'number' OR
   (tier->>'minimumHoursBeforeAppointment')::numeric < 0 OR (tier->>'minimumHoursBeforeAppointment')::numeric * 60 > 9007199254740991 OR
   (tier->>'minimumHoursBeforeAppointment')::numeric * 60 != round((tier->>'minimumHoursBeforeAppointment')::numeric * 60) OR
   (tier ? 'minimumMinutesBeforeAppointment' AND (tier->'minimumMinutesBeforeAppointment') IS DISTINCT FROM to_jsonb((tier->>'minimumHoursBeforeAppointment')::numeric * 60)))) THEN
  RAISE EXCEPTION 'Invalid or conflicting policy time units';
 END IF;
END $$;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM "BranchCancellationPolicy", jsonb_array_elements("refundTiers"::jsonb) AS tier
  WHERE tier ? 'minimumHoursAfterPurchase' AND (jsonb_typeof(tier->'minimumHoursAfterPurchase') != 'number' OR
   (tier->>'minimumHoursAfterPurchase')::numeric < 0 OR (tier->>'minimumHoursAfterPurchase')::numeric * 60 > 9007199254740991 OR
   (tier->>'minimumHoursAfterPurchase')::numeric * 60 != round((tier->>'minimumHoursAfterPurchase')::numeric * 60) OR
   (tier ? 'minimumMinutesAfterPurchase' AND (tier->'minimumMinutesAfterPurchase') IS DISTINCT FROM to_jsonb((tier->>'minimumHoursAfterPurchase')::numeric * 60)))) THEN
  RAISE EXCEPTION 'Invalid or conflicting policy time units';
 END IF;
END $$;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM "GroupPurchaseRefundPolicy", jsonb_array_elements("refundTiers"::jsonb) AS tier
  WHERE tier ? 'minimumHoursBefore' AND (jsonb_typeof(tier->'minimumHoursBefore') != 'number' OR
   (tier->>'minimumHoursBefore')::numeric < 0 OR (tier->>'minimumHoursBefore')::numeric * 60 > 9007199254740991 OR
   (tier->>'minimumHoursBefore')::numeric * 60 != round((tier->>'minimumHoursBefore')::numeric * 60) OR
   (tier ? 'minimumMinutesBefore' AND (tier->'minimumMinutesBefore') IS DISTINCT FROM to_jsonb((tier->>'minimumHoursBefore')::numeric * 60)))) THEN
  RAISE EXCEPTION 'Invalid or conflicting policy time units';
 END IF;
END $$;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM "GroupPurchaseRefundPolicy", jsonb_array_elements("refundTiers"::jsonb) AS tier
  WHERE tier ? 'minimumHoursBeforeAppointment' AND (jsonb_typeof(tier->'minimumHoursBeforeAppointment') != 'number' OR
   (tier->>'minimumHoursBeforeAppointment')::numeric < 0 OR (tier->>'minimumHoursBeforeAppointment')::numeric * 60 > 9007199254740991 OR
   (tier->>'minimumHoursBeforeAppointment')::numeric * 60 != round((tier->>'minimumHoursBeforeAppointment')::numeric * 60) OR
   (tier ? 'minimumMinutesBeforeAppointment' AND (tier->'minimumMinutesBeforeAppointment') IS DISTINCT FROM to_jsonb((tier->>'minimumHoursBeforeAppointment')::numeric * 60)))) THEN
  RAISE EXCEPTION 'Invalid or conflicting policy time units';
 END IF;
END $$;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM "GroupPurchaseRefundPolicy", jsonb_array_elements("refundTiers"::jsonb) AS tier
  WHERE tier ? 'minimumHoursAfterPurchase' AND (jsonb_typeof(tier->'minimumHoursAfterPurchase') != 'number' OR
   (tier->>'minimumHoursAfterPurchase')::numeric < 0 OR (tier->>'minimumHoursAfterPurchase')::numeric * 60 > 9007199254740991 OR
   (tier->>'minimumHoursAfterPurchase')::numeric * 60 != round((tier->>'minimumHoursAfterPurchase')::numeric * 60) OR
   (tier ? 'minimumMinutesAfterPurchase' AND (tier->'minimumMinutesAfterPurchase') IS DISTINCT FROM to_jsonb((tier->>'minimumHoursAfterPurchase')::numeric * 60)))) THEN
  RAISE EXCEPTION 'Invalid or conflicting policy time units';
 END IF;
END $$;
-- Preserve real thresholds; immutable historical snapshots normalize on read.
ALTER TABLE "BranchBookingPolicy" RENAME COLUMN "cancellationCutoffHours" TO "cancellationCutoffMinutes";
ALTER TABLE "BranchBookingPolicy" ALTER COLUMN "cancellationCutoffMinutes" SET DEFAULT 720;
UPDATE "BranchBookingPolicy" SET "cancellationCutoffMinutes" = ("cancellationCutoffMinutes"::bigint * 60)::integer;
ALTER TABLE "BranchBookingPolicy" RENAME COLUMN "rescheduleCutoffHours" TO "rescheduleCutoffMinutes";
ALTER TABLE "BranchBookingPolicy" ALTER COLUMN "rescheduleCutoffMinutes" SET DEFAULT 720;
UPDATE "BranchBookingPolicy" SET "rescheduleCutoffMinutes" = ("rescheduleCutoffMinutes"::bigint * 60)::integer;
ALTER TABLE "BranchCancellationPolicy" RENAME COLUMN "minimumCancellationHours" TO "minimumCancellationMinutes";
ALTER TABLE "BranchCancellationPolicy" ALTER COLUMN "minimumCancellationMinutes" SET DEFAULT 120;
UPDATE "BranchCancellationPolicy" SET "minimumCancellationMinutes" = ("minimumCancellationMinutes"::bigint * 60)::integer;
ALTER TABLE "GroupPurchaseCancellationPolicy" RENAME COLUMN "minimumCancellationHours" TO "minimumCancellationMinutes";
ALTER TABLE "GroupPurchaseCancellationPolicy" ALTER COLUMN "minimumCancellationMinutes" SET DEFAULT 120;
UPDATE "GroupPurchaseCancellationPolicy" SET "minimumCancellationMinutes" = ("minimumCancellationMinutes"::bigint * 60)::integer;
ALTER TABLE "GroupPurchaseCancellationPolicy" RENAME COLUMN "restorationMinimumHours" TO "restorationMinimumMinutes";
ALTER TABLE "GroupPurchaseCancellationPolicy" ALTER COLUMN "restorationMinimumMinutes" SET DEFAULT 1440;
UPDATE "GroupPurchaseCancellationPolicy" SET "restorationMinimumMinutes" = ("restorationMinimumMinutes"::bigint * 60)::integer;
UPDATE "BranchCancellationPolicy" SET "refundTiers" = COALESCE((
 SELECT jsonb_agg(CASE WHEN tier ? 'minimumHoursBefore' THEN (tier - 'minimumHoursBefore') || jsonb_build_object('minimumMinutesBefore', ((tier->>'minimumHoursBefore')::numeric * 60)) ELSE tier END ORDER BY ordinal)
 FROM jsonb_array_elements("refundTiers"::jsonb) WITH ORDINALITY AS items(tier,ordinal)
), '[]'::jsonb) WHERE jsonb_typeof("refundTiers"::jsonb) = 'array';
UPDATE "BranchCancellationPolicy" SET "refundTiers" = COALESCE((
 SELECT jsonb_agg(CASE WHEN tier ? 'minimumHoursBeforeAppointment' THEN (tier - 'minimumHoursBeforeAppointment') || jsonb_build_object('minimumMinutesBeforeAppointment', ((tier->>'minimumHoursBeforeAppointment')::numeric * 60)) ELSE tier END ORDER BY ordinal)
 FROM jsonb_array_elements("refundTiers"::jsonb) WITH ORDINALITY AS items(tier,ordinal)
), '[]'::jsonb) WHERE jsonb_typeof("refundTiers"::jsonb) = 'array';
UPDATE "BranchCancellationPolicy" SET "refundTiers" = COALESCE((
 SELECT jsonb_agg(CASE WHEN tier ? 'minimumHoursAfterPurchase' THEN (tier - 'minimumHoursAfterPurchase') || jsonb_build_object('minimumMinutesAfterPurchase', ((tier->>'minimumHoursAfterPurchase')::numeric * 60)) ELSE tier END ORDER BY ordinal)
 FROM jsonb_array_elements("refundTiers"::jsonb) WITH ORDINALITY AS items(tier,ordinal)
), '[]'::jsonb) WHERE jsonb_typeof("refundTiers"::jsonb) = 'array';
UPDATE "GroupPurchaseRefundPolicy" SET "refundTiers" = COALESCE((
 SELECT jsonb_agg(CASE WHEN tier ? 'minimumHoursBefore' THEN (tier - 'minimumHoursBefore') || jsonb_build_object('minimumMinutesBefore', ((tier->>'minimumHoursBefore')::numeric * 60)) ELSE tier END ORDER BY ordinal)
 FROM jsonb_array_elements("refundTiers"::jsonb) WITH ORDINALITY AS items(tier,ordinal)
), '[]'::jsonb) WHERE jsonb_typeof("refundTiers"::jsonb) = 'array';
UPDATE "GroupPurchaseRefundPolicy" SET "refundTiers" = COALESCE((
 SELECT jsonb_agg(CASE WHEN tier ? 'minimumHoursBeforeAppointment' THEN (tier - 'minimumHoursBeforeAppointment') || jsonb_build_object('minimumMinutesBeforeAppointment', ((tier->>'minimumHoursBeforeAppointment')::numeric * 60)) ELSE tier END ORDER BY ordinal)
 FROM jsonb_array_elements("refundTiers"::jsonb) WITH ORDINALITY AS items(tier,ordinal)
), '[]'::jsonb) WHERE jsonb_typeof("refundTiers"::jsonb) = 'array';
UPDATE "GroupPurchaseRefundPolicy" SET "refundTiers" = COALESCE((
 SELECT jsonb_agg(CASE WHEN tier ? 'minimumHoursAfterPurchase' THEN (tier - 'minimumHoursAfterPurchase') || jsonb_build_object('minimumMinutesAfterPurchase', ((tier->>'minimumHoursAfterPurchase')::numeric * 60)) ELSE tier END ORDER BY ordinal)
 FROM jsonb_array_elements("refundTiers"::jsonb) WITH ORDINALITY AS items(tier,ordinal)
), '[]'::jsonb) WHERE jsonb_typeof("refundTiers"::jsonb) = 'array';
COMMIT;
