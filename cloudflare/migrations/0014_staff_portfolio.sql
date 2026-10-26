CREATE TABLE "StaffPortfolioCase" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "staffId" TEXT NOT NULL,
    "serviceId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "tags" JSONB NOT NULL DEFAULT [],
    "translations" JSONB,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StaffPortfolioCase_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StaffPortfolioCase_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "StaffPortfolioCaseImage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "isCover" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StaffPortfolioCaseImage_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "StaffPortfolioCase" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "StaffPortfolioCase_staffId_idx" ON "StaffPortfolioCase"("staffId");

CREATE INDEX "StaffPortfolioCase_serviceId_idx" ON "StaffPortfolioCase"("serviceId");

CREATE INDEX "StaffPortfolioCase_staffId_status_idx" ON "StaffPortfolioCase"("staffId", "status");

CREATE INDEX "StaffPortfolioCase_staffId_sortOrder_idx" ON "StaffPortfolioCase"("staffId", "sortOrder");

CREATE INDEX "StaffPortfolioCaseImage_caseId_idx" ON "StaffPortfolioCaseImage"("caseId");

CREATE INDEX "StaffPortfolioCaseImage_caseId_sortOrder_idx" ON "StaffPortfolioCaseImage"("caseId", "sortOrder");
