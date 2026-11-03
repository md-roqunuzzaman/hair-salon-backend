-- AlterTable
ALTER TABLE "StaffPortfolioCase" ADD COLUMN     "showInBranchPortfolio" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "BranchPortfolioCase" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "serviceId" TEXT,
    "staffId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "tags" JSONB NOT NULL DEFAULT '[]',
    "translations" JSONB,
    "status" "StaffPortfolioStatus" NOT NULL DEFAULT 'DRAFT',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BranchPortfolioCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BranchPortfolioCaseImage" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "isCover" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BranchPortfolioCaseImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BranchPortfolioCase_branchId_idx" ON "BranchPortfolioCase"("branchId");

-- CreateIndex
CREATE INDEX "BranchPortfolioCase_serviceId_idx" ON "BranchPortfolioCase"("serviceId");

-- CreateIndex
CREATE INDEX "BranchPortfolioCase_staffId_idx" ON "BranchPortfolioCase"("staffId");

-- CreateIndex
CREATE INDEX "BranchPortfolioCase_branchId_status_idx" ON "BranchPortfolioCase"("branchId", "status");

-- CreateIndex
CREATE INDEX "BranchPortfolioCase_branchId_sortOrder_idx" ON "BranchPortfolioCase"("branchId", "sortOrder");

-- CreateIndex
CREATE INDEX "BranchPortfolioCaseImage_caseId_idx" ON "BranchPortfolioCaseImage"("caseId");

-- CreateIndex
CREATE INDEX "BranchPortfolioCaseImage_caseId_sortOrder_idx" ON "BranchPortfolioCaseImage"("caseId", "sortOrder");

-- AddForeignKey
ALTER TABLE "BranchPortfolioCase" ADD CONSTRAINT "BranchPortfolioCase_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchPortfolioCase" ADD CONSTRAINT "BranchPortfolioCase_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchPortfolioCase" ADD CONSTRAINT "BranchPortfolioCase_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchPortfolioCaseImage" ADD CONSTRAINT "BranchPortfolioCaseImage_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "BranchPortfolioCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
