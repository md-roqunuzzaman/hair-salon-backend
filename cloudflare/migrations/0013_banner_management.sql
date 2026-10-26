CREATE TABLE "Banner" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "brandId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "scope" TEXT NOT NULL DEFAULT 'SELECTED_BRANCHES',
    "startAt" DATETIME,
    "endAt" DATETIME,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Banner_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "BannerBranch" (
    "bannerId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,

    PRIMARY KEY ("bannerId", "branchId"),
    CONSTRAINT "BannerBranch_bannerId_fkey" FOREIGN KEY ("bannerId") REFERENCES "Banner" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BannerBranch_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "BannerMedia" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bannerId" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BannerMedia_bannerId_fkey" FOREIGN KEY ("bannerId") REFERENCES "Banner" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "Banner_brandId_status_idx" ON "Banner"("brandId", "status");

CREATE INDEX "Banner_brandId_scope_idx" ON "Banner"("brandId", "scope");

CREATE INDEX "Banner_startAt_endAt_idx" ON "Banner"("startAt", "endAt");

CREATE INDEX "Banner_sortOrder_idx" ON "Banner"("sortOrder");

CREATE INDEX "BannerBranch_branchId_idx" ON "BannerBranch"("branchId");

CREATE INDEX "BannerMedia_bannerId_sortOrder_idx" ON "BannerMedia"("bannerId", "sortOrder");
