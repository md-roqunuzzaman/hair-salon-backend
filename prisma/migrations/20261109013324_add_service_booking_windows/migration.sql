-- AlterTable
ALTER TABLE "ServiceBranch" ADD COLUMN     "bookingHoursEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ServiceBookingWindow" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "day" "DayOfWeek" NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceBookingWindow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ServiceBookingWindow_serviceId_branchId_day_idx" ON "ServiceBookingWindow"("serviceId", "branchId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceBookingWindow_serviceId_branchId_day_startTime_endTi_key" ON "ServiceBookingWindow"("serviceId", "branchId", "day", "startTime", "endTime");

-- AddForeignKey
ALTER TABLE "ServiceBookingWindow" ADD CONSTRAINT "ServiceBookingWindow_serviceId_branchId_fkey" FOREIGN KEY ("serviceId", "branchId") REFERENCES "ServiceBranch"("serviceId", "branchId") ON DELETE CASCADE ON UPDATE CASCADE;
