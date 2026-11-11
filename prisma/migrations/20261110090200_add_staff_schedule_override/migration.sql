-- CreateTable
CREATE TABLE "StaffScheduleOverride" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffScheduleOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StaffScheduleOverride_branchId_date_idx" ON "StaffScheduleOverride"("branchId", "date");

-- CreateIndex
CREATE INDEX "StaffScheduleOverride_staffId_branchId_idx" ON "StaffScheduleOverride"("staffId", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffScheduleOverride_staffId_date_key" ON "StaffScheduleOverride"("staffId", "date");

-- AddForeignKey
ALTER TABLE "StaffScheduleOverride" ADD CONSTRAINT "StaffScheduleOverride_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffScheduleOverride" ADD CONSTRAINT "StaffScheduleOverride_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
