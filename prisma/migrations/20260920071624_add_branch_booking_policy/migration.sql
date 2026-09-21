-- CreateEnum
CREATE TYPE "ReserveExpiryRule" AS ENUM ('APPOINTMENT_TIME');

-- CreateTable
CREATE TABLE "BranchBookingPolicy" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "slotIntervalMinutes" INTEGER NOT NULL DEFAULT 30,
    "minimumBookingNoticeMinutes" INTEGER NOT NULL DEFAULT 120,
    "maximumAdvanceBookingDays" INTEGER NOT NULL DEFAULT 30,
    "cancellationCutoffHours" INTEGER NOT NULL DEFAULT 12,
    "rescheduleCutoffHours" INTEGER NOT NULL DEFAULT 12,
    "reserveExpiryRule" "ReserveExpiryRule" NOT NULL DEFAULT 'APPOINTMENT_TIME',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BranchBookingPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BranchBookingPolicy_branchId_key" ON "BranchBookingPolicy"("branchId");

-- AddForeignKey
ALTER TABLE "BranchBookingPolicy" ADD CONSTRAINT "BranchBookingPolicy_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
