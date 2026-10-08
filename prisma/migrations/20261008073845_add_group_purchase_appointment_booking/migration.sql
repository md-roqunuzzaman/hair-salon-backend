-- AlterEnum
ALTER TYPE "BookingMethod" ADD VALUE 'GROUP_PURCHASE';

-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "groupPurchaseId" TEXT;

-- CreateIndex
CREATE INDEX "Appointment_groupPurchaseId_idx" ON "Appointment"("groupPurchaseId");

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_groupPurchaseId_fkey" FOREIGN KEY ("groupPurchaseId") REFERENCES "GroupPurchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
