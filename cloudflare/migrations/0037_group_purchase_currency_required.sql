-- Fail before recording v37 if historical NULLs still need reconciliation.
-- This migration never assigns a denomination or rewrites purchase rows.
CREATE TABLE "_GroupPurchaseCurrencyRequiredGuard" (
  "nullCount" INTEGER NOT NULL,
  CONSTRAINT "GroupPurchase_currency_requires_reconciliation" CHECK ("nullCount" = 0)
);
INSERT INTO "_GroupPurchaseCurrencyRequiredGuard" ("nullCount")
SELECT COUNT(*) FROM "GroupPurchase" WHERE "currency" IS NULL;
DROP TABLE "_GroupPurchaseCurrencyRequiredGuard";

-- Match the existing v16 required-field strategy without rebuilding a referenced table.
CREATE TRIGGER "required_GroupPurchase_currency_INSERT" BEFORE INSERT ON "GroupPurchase"
WHEN NEW."currency" IS NULL BEGIN
  SELECT RAISE(ABORT, 'NOT NULL constraint failed: GroupPurchase.currency');
END;

CREATE TRIGGER "required_GroupPurchase_currency_UPDATE" BEFORE UPDATE ON "GroupPurchase"
WHEN NEW."currency" IS NULL BEGIN
  SELECT RAISE(ABORT, 'NOT NULL constraint failed: GroupPurchase.currency');
END;
