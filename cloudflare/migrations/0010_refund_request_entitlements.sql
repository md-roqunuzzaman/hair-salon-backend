-- Extend v9 without changing historical migration checksums.
ALTER TABLE "GroupPurchase" ADD COLUMN "forfeitedQuantity" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "GroupPurchase" ADD COLUMN "refundedQuantity" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "RefundRequest" ADD COLUMN "requestType" TEXT NOT NULL DEFAULT 'APPOINTMENT_CANCELLATION';
ALTER TABLE "RefundRequest" ADD COLUMN "policySnapshot" JSONB;
ALTER TABLE "RefundRequest" ADD COLUMN "policyVersion" INTEGER;
ALTER TABLE "RefundRequest" ADD COLUMN "eligiblePaidAmount" BIGINT;
ALTER TABLE "RefundRequest" ADD COLUMN "refundPercentage" BIGINT;
ALTER TABLE "RefundRequest" ADD COLUMN "refundDeduction" BIGINT;
ALTER TABLE "RefundRequest" ADD COLUMN "isCancellationOnly" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "RefundRequest" ADD COLUMN "policyEvaluatedAt" DATETIME;
ALTER TABLE "RefundRequest" ADD COLUMN "idempotencyKey" TEXT;
CREATE UNIQUE INDEX "RefundRequest_idempotencyKey_key" ON "RefundRequest"("idempotencyKey");

-- Classify all historical group requests by their payment, not a particular row ID.
UPDATE "RefundRequest" SET "requestType" = 'GROUP_PURCHASE_REFUND'
WHERE "paymentId" IN (SELECT "id" FROM "Payment" WHERE "purpose" = 'GROUP_PURCHASE');

ALTER TABLE "GroupPurchaseCancellationPolicy" ADD COLUMN "lateCancellationOutcome" TEXT NOT NULL DEFAULT 'FORFEITED';
UPDATE "GroupPurchaseCancellationPolicy" SET "lateCancellationOutcome" =
  CASE WHEN "forfeitOnLateCancellation" = 0 THEN 'RESTORED' ELSE 'FORFEITED' END;
ALTER TABLE "GroupPurchaseCancellationPolicy" DROP COLUMN "forfeitOnLateCancellation";

CREATE TRIGGER "money_RefundRequest_eligiblePaidAmount_INSERT" BEFORE INSERT ON "RefundRequest" WHEN NEW."eligiblePaidAmount" IS NOT NULL AND (typeof(NEW."eligiblePaidAmount") != 'integer' OR abs(NEW."eligiblePaidAmount") > 9999999999) BEGIN SELECT RAISE(ABORT, 'Money precision exceeded'); END;
CREATE TRIGGER "money_RefundRequest_eligiblePaidAmount_UPDATE" BEFORE UPDATE ON "RefundRequest" WHEN NEW."eligiblePaidAmount" IS NOT NULL AND (typeof(NEW."eligiblePaidAmount") != 'integer' OR abs(NEW."eligiblePaidAmount") > 9999999999) BEGIN SELECT RAISE(ABORT, 'Money precision exceeded'); END;
CREATE TRIGGER "money_RefundRequest_refundPercentage_INSERT" BEFORE INSERT ON "RefundRequest" WHEN NEW."refundPercentage" IS NOT NULL AND (typeof(NEW."refundPercentage") != 'integer' OR abs(NEW."refundPercentage") > 99999) BEGIN SELECT RAISE(ABORT, 'Money precision exceeded'); END;
CREATE TRIGGER "money_RefundRequest_refundPercentage_UPDATE" BEFORE UPDATE ON "RefundRequest" WHEN NEW."refundPercentage" IS NOT NULL AND (typeof(NEW."refundPercentage") != 'integer' OR abs(NEW."refundPercentage") > 99999) BEGIN SELECT RAISE(ABORT, 'Money precision exceeded'); END;
CREATE TRIGGER "money_RefundRequest_refundDeduction_INSERT" BEFORE INSERT ON "RefundRequest" WHEN NEW."refundDeduction" IS NOT NULL AND (typeof(NEW."refundDeduction") != 'integer' OR abs(NEW."refundDeduction") > 9999999999) BEGIN SELECT RAISE(ABORT, 'Money precision exceeded'); END;
CREATE TRIGGER "money_RefundRequest_refundDeduction_UPDATE" BEFORE UPDATE ON "RefundRequest" WHEN NEW."refundDeduction" IS NOT NULL AND (typeof(NEW."refundDeduction") != 'integer' OR abs(NEW."refundDeduction") > 9999999999) BEGIN SELECT RAISE(ABORT, 'Money precision exceeded'); END;
