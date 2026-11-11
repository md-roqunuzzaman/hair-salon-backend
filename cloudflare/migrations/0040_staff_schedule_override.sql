-- Add date-specific staff schedules without changing existing schedules.
CREATE TABLE "StaffScheduleOverride" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "staffId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StaffScheduleOverride_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StaffScheduleOverride_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "StaffScheduleOverride_branchId_date_idx" ON "StaffScheduleOverride"("branchId", "date");
CREATE INDEX "StaffScheduleOverride_staffId_branchId_idx" ON "StaffScheduleOverride"("staffId", "branchId");
CREATE UNIQUE INDEX "StaffScheduleOverride_staffId_date_key" ON "StaffScheduleOverride"("staffId", "date");
