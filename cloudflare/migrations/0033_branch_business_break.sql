-- Add branch-wide break intervals without changing existing opening hours.
CREATE TABLE "BranchBusinessBreak" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "businessHourId" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    CONSTRAINT "BranchBusinessBreak_businessHourId_fkey" FOREIGN KEY ("businessHourId") REFERENCES "BranchBusinessHour" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "BranchBusinessBreak_businessHourId_idx" ON "BranchBusinessBreak"("businessHourId");
