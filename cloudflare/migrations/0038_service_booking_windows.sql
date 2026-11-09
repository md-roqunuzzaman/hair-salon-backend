-- Preserve existing service/branch assignments with booking hours disabled.
ALTER TABLE "ServiceBranch" ADD COLUMN "bookingHoursEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ServiceBookingWindow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "serviceId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ServiceBookingWindow_serviceId_branchId_fkey" FOREIGN KEY ("serviceId", "branchId") REFERENCES "ServiceBranch" ("serviceId", "branchId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ServiceBookingWindow_serviceId_branchId_day_idx" ON "ServiceBookingWindow"("serviceId", "branchId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceBookingWindow_serviceId_branchId_day_startTime_endTime_key" ON "ServiceBookingWindow"("serviceId", "branchId", "day", "startTime", "endTime");
