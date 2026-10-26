-- CreateEnum
CREATE TYPE "StaffPortfolioStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'HIDDEN');

-- CreateTable
CREATE TABLE "StaffPortfolioCase" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "serviceId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "translations" JSONB,
    "status" "StaffPortfolioStatus" NOT NULL DEFAULT 'DRAFT',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffPortfolioCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffPortfolioCaseImage" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "isCover" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffPortfolioCaseImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StaffPortfolioCase_staffId_idx" ON "StaffPortfolioCase"("staffId");

-- CreateIndex
CREATE INDEX "StaffPortfolioCase_serviceId_idx" ON "StaffPortfolioCase"("serviceId");

-- CreateIndex
CREATE INDEX "StaffPortfolioCase_staffId_status_idx" ON "StaffPortfolioCase"("staffId", "status");

-- CreateIndex
CREATE INDEX "StaffPortfolioCase_staffId_sortOrder_idx" ON "StaffPortfolioCase"("staffId", "sortOrder");

-- CreateIndex
CREATE INDEX "StaffPortfolioCaseImage_caseId_idx" ON "StaffPortfolioCaseImage"("caseId");

-- CreateIndex
CREATE INDEX "StaffPortfolioCaseImage_caseId_sortOrder_idx" ON "StaffPortfolioCaseImage"("caseId", "sortOrder");

-- AddForeignKey
ALTER TABLE "StaffPortfolioCase" ADD CONSTRAINT "StaffPortfolioCase_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffPortfolioCase" ADD CONSTRAINT "StaffPortfolioCase_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffPortfolioCaseImage" ADD CONSTRAINT "StaffPortfolioCaseImage_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "StaffPortfolioCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
