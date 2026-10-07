-- CreateTable
CREATE TABLE "BranchHourlyCapacity" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "day" "DayOfWeek" NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "maxBookings" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BranchHourlyCapacity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BranchHourlyCapacity_branchId_day_idx" ON "BranchHourlyCapacity"("branchId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "BranchHourlyCapacity_branchId_day_startTime_endTime_key" ON "BranchHourlyCapacity"("branchId", "day", "startTime", "endTime");

-- AddForeignKey
ALTER TABLE "BranchHourlyCapacity" ADD CONSTRAINT "BranchHourlyCapacity_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
