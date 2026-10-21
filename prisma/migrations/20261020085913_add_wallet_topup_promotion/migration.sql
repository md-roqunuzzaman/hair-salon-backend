-- AlterTable
ALTER TABLE "WalletTopup" ADD COLUMN     "promotionId" TEXT;

-- AddForeignKey
ALTER TABLE "WalletTopup" ADD CONSTRAINT "WalletTopup_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "Promotion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
