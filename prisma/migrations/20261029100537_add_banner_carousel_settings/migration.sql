-- CreateTable
CREATE TABLE "BannerCarouselSetting" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "branchId" TEXT,
    "imageIntervalMs" INTEGER NOT NULL DEFAULT 5000,
    "videoIntervalMs" INTEGER NOT NULL DEFAULT 15000,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BannerCarouselSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BannerCarouselSetting_branchId_key" ON "BannerCarouselSetting"("branchId");

-- CreateIndex
CREATE INDEX "BannerCarouselSetting_brandId_idx" ON "BannerCarouselSetting"("brandId");

-- AddForeignKey
ALTER TABLE "BannerCarouselSetting" ADD CONSTRAINT "BannerCarouselSetting_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BannerCarouselSetting" ADD CONSTRAINT "BannerCarouselSetting_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
