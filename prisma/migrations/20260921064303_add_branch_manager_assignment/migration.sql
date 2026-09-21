-- CreateTable
CREATE TABLE "BranchManagerBranch" (
    "userId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BranchManagerBranch_pkey" PRIMARY KEY ("userId","branchId")
);

-- CreateIndex
CREATE INDEX "BranchManagerBranch_branchId_idx" ON "BranchManagerBranch"("branchId");

-- AddForeignKey
ALTER TABLE "BranchManagerBranch" ADD CONSTRAINT "BranchManagerBranch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchManagerBranch" ADD CONSTRAINT "BranchManagerBranch_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
