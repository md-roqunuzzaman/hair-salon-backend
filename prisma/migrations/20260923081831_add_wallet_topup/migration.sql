-- CreateEnum
CREATE TYPE "WalletTopupStatus" AS ENUM ('PENDING', 'PAID', 'FAILED');

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "walletTopupId" TEXT;

-- CreateTable
CREATE TABLE "WalletTopup" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "potentialBonus" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "status" "WalletTopupStatus" NOT NULL DEFAULT 'PENDING',
    "providerPaymentId" TEXT,
    "paidAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WalletTopup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WalletTopup_providerPaymentId_key" ON "WalletTopup"("providerPaymentId");

-- CreateIndex
CREATE INDEX "WalletTopup_walletId_idx" ON "WalletTopup"("walletId");

-- CreateIndex
CREATE INDEX "WalletTopup_status_idx" ON "WalletTopup"("status");

-- CreateIndex
CREATE INDEX "Payment_walletTopupId_idx" ON "Payment"("walletTopupId");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_walletTopupId_fkey" FOREIGN KEY ("walletTopupId") REFERENCES "WalletTopup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletTopup" ADD CONSTRAINT "WalletTopup_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
