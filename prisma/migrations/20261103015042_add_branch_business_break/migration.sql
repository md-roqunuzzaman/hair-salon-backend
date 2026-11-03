-- CreateTable
CREATE TABLE "BranchBusinessBreak" (
    "id" TEXT NOT NULL,
    "businessHourId" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,

    CONSTRAINT "BranchBusinessBreak_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BranchBusinessBreak_businessHourId_idx" ON "BranchBusinessBreak"("businessHourId");

-- AddForeignKey
ALTER TABLE "BranchBusinessBreak" ADD CONSTRAINT "BranchBusinessBreak_businessHourId_fkey" FOREIGN KEY ("businessHourId") REFERENCES "BranchBusinessHour"("id") ON DELETE CASCADE ON UPDATE CASCADE;
