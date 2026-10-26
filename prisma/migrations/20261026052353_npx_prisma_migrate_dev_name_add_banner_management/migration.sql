-- CreateEnum
CREATE TYPE "BannerStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "BannerScope" AS ENUM ('BRAND_WIDE', 'SELECTED_BRANCHES');

-- CreateEnum
CREATE TYPE "BannerMediaType" AS ENUM ('IMAGE', 'VIDEO');

-- CreateTable
CREATE TABLE "Banner" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "BannerStatus" NOT NULL DEFAULT 'DRAFT',
    "scope" "BannerScope" NOT NULL DEFAULT 'SELECTED_BRANCHES',
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Banner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BannerBranch" (
    "bannerId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,

    CONSTRAINT "BannerBranch_pkey" PRIMARY KEY ("bannerId","branchId")
);

-- CreateTable
CREATE TABLE "BannerMedia" (
    "id" TEXT NOT NULL,
    "bannerId" TEXT NOT NULL,
    "mediaType" "BannerMediaType" NOT NULL,
    "objectKey" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BannerMedia_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Banner_brandId_status_idx" ON "Banner"("brandId", "status");

-- CreateIndex
CREATE INDEX "Banner_brandId_scope_idx" ON "Banner"("brandId", "scope");

-- CreateIndex
CREATE INDEX "Banner_startAt_endAt_idx" ON "Banner"("startAt", "endAt");

-- CreateIndex
CREATE INDEX "Banner_sortOrder_idx" ON "Banner"("sortOrder");

-- CreateIndex
CREATE INDEX "BannerBranch_branchId_idx" ON "BannerBranch"("branchId");

-- CreateIndex
CREATE INDEX "BannerMedia_bannerId_sortOrder_idx" ON "BannerMedia"("bannerId", "sortOrder");

-- AddForeignKey
ALTER TABLE "Banner" ADD CONSTRAINT "Banner_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BannerBranch" ADD CONSTRAINT "BannerBranch_bannerId_fkey" FOREIGN KEY ("bannerId") REFERENCES "Banner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BannerBranch" ADD CONSTRAINT "BannerBranch_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BannerMedia" ADD CONSTRAINT "BannerMedia_bannerId_fkey" FOREIGN KEY ("bannerId") REFERENCES "Banner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
