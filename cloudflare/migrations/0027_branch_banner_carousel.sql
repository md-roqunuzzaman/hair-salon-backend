-- Add the final branch-scoped model directly; there is no pre-existing carousel
-- table in the v26 Worker database. Preserve all existing banners/media/data.
CREATE TABLE "BannerCarouselSetting" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "branchId" TEXT NOT NULL,
  "imageIntervalMs" INTEGER NOT NULL DEFAULT 5000,
  "videoIntervalMs" INTEGER NOT NULL DEFAULT 15000,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  "brandId" TEXT,
  CONSTRAINT "BannerCarouselSetting_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "BannerCarouselSetting_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "BannerCarouselSetting_branchId_key" ON "BannerCarouselSetting"("branchId");
