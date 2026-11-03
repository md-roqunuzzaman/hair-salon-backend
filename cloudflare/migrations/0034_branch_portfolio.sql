-- Preserve existing staff portfolios; branch ownership remains unset until configured.
ALTER TABLE "StaffPortfolioCase" ADD COLUMN "showInBranchPortfolio" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "StaffPortfolioCase" ADD COLUMN "branchId" TEXT REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "BranchPortfolioCase" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "branchId" TEXT NOT NULL,
    "serviceId" TEXT,
    "staffId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "tags" JSONB NOT NULL DEFAULT [],
    "translations" JSONB,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BranchPortfolioCase_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BranchPortfolioCase_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "BranchPortfolioCase_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "BranchPortfolioCaseImage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "isCover" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BranchPortfolioCaseImage_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "BranchPortfolioCase"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "BranchPortfolioCase_branchId_idx" ON "BranchPortfolioCase"("branchId");
CREATE INDEX "BranchPortfolioCase_serviceId_idx" ON "BranchPortfolioCase"("serviceId");
CREATE INDEX "BranchPortfolioCase_staffId_idx" ON "BranchPortfolioCase"("staffId");
CREATE INDEX "BranchPortfolioCase_branchId_status_idx" ON "BranchPortfolioCase"("branchId", "status");
CREATE INDEX "BranchPortfolioCase_branchId_sortOrder_idx" ON "BranchPortfolioCase"("branchId", "sortOrder");
CREATE INDEX "BranchPortfolioCaseImage_caseId_idx" ON "BranchPortfolioCaseImage"("caseId");
CREATE INDEX "BranchPortfolioCaseImage_caseId_sortOrder_idx" ON "BranchPortfolioCaseImage"("caseId", "sortOrder");
CREATE INDEX "StaffPortfolioCase_branchId_idx" ON "StaffPortfolioCase"("branchId");
CREATE INDEX "StaffPortfolioCase_branchId_status_showInBranchPortfolio_idx" ON "StaffPortfolioCase"("branchId", "status", "showInBranchPortfolio");
