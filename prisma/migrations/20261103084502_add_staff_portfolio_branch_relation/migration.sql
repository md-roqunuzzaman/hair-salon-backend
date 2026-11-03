-- AlterTable
ALTER TABLE "StaffPortfolioCase" ADD COLUMN     "branchId" TEXT;

-- CreateIndex
CREATE INDEX "StaffPortfolioCase_branchId_idx" ON "StaffPortfolioCase"("branchId");

-- CreateIndex
CREATE INDEX "StaffPortfolioCase_branchId_status_showInBranchPortfolio_idx" ON "StaffPortfolioCase"("branchId", "status", "showInBranchPortfolio");

-- AddForeignKey
ALTER TABLE "StaffPortfolioCase" ADD CONSTRAINT "StaffPortfolioCase_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
