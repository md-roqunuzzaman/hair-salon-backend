-- CreateEnum
CREATE TYPE "DayOfWeek" AS ENUM ('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY');

-- CreateTable
CREATE TABLE "BranchBusinessHour" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "day" "DayOfWeek" NOT NULL,
    "isClosed" BOOLEAN NOT NULL DEFAULT false,
    "openTime" TEXT,
    "closeTime" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BranchBusinessHour_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BranchBusinessHour_branchId_day_key" ON "BranchBusinessHour"("branchId", "day");

-- AddForeignKey
ALTER TABLE "BranchBusinessHour" ADD CONSTRAINT "BranchBusinessHour_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
