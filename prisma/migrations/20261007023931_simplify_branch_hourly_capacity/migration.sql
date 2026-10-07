/*
  Warnings:

  - You are about to drop the column `endTime` on the `BranchHourlyCapacity` table. All the data in the column will be lost.
  - You are about to drop the column `maxBookings` on the `BranchHourlyCapacity` table. All the data in the column will be lost.
  - You are about to drop the column `startTime` on the `BranchHourlyCapacity` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[branchId,day]` on the table `BranchHourlyCapacity` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `maxBookingsPerHour` to the `BranchHourlyCapacity` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "BranchHourlyCapacity_branchId_day_idx";

-- DropIndex
DROP INDEX "BranchHourlyCapacity_branchId_day_startTime_endTime_key";

-- AlterTable
ALTER TABLE "BranchHourlyCapacity" DROP COLUMN "endTime",
DROP COLUMN "maxBookings",
DROP COLUMN "startTime",
ADD COLUMN     "maxBookingsPerHour" INTEGER NOT NULL;

-- CreateIndex
CREATE INDEX "BranchHourlyCapacity_branchId_idx" ON "BranchHourlyCapacity"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "BranchHourlyCapacity_branchId_day_key" ON "BranchHourlyCapacity"("branchId", "day");
