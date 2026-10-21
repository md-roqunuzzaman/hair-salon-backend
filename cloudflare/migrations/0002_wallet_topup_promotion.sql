-- Existing top-ups retain NULL; their original amount and bonus snapshots stay intact.
ALTER TABLE "WalletTopup" ADD COLUMN "promotionId" TEXT
  REFERENCES "Promotion" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
