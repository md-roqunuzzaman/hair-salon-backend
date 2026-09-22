-- CreateEnum
CREATE TYPE "StaffUnavailabilityType" AS ENUM ('BREAK', 'TIME_OFF', 'LEAVE', 'BLOCKED');

-- CreateTable
CREATE TABLE "StaffUnavailability" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "type" "StaffUnavailabilityType" NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffUnavailability_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StaffUnavailability_staffId_idx" ON "StaffUnavailability"("staffId");

-- CreateIndex
CREATE INDEX "StaffUnavailability_date_idx" ON "StaffUnavailability"("date");

-- CreateIndex
CREATE INDEX "StaffUnavailability_staffId_date_idx" ON "StaffUnavailability"("staffId", "date");

-- AddForeignKey
ALTER TABLE "StaffUnavailability" ADD CONSTRAINT "StaffUnavailability_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;
