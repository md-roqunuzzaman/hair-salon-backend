/*
  Warnings:

  - Made the column `branchId` on table `BannerCarouselSetting` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "BannerCarouselSetting" DROP CONSTRAINT "BannerCarouselSetting_brandId_fkey";

-- DropIndex
DROP INDEX "BannerCarouselSetting_brandId_idx";

-- AlterTable
ALTER TABLE "BannerCarouselSetting" ALTER COLUMN "brandId" DROP NOT NULL,
ALTER COLUMN "branchId" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "BannerCarouselSetting" ADD CONSTRAINT "BannerCarouselSetting_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;
