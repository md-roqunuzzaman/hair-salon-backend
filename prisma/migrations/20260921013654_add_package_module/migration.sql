-- CreateEnum
CREATE TYPE "PackageType" AS ENUM ('STANDARD_SERVICE_PACKAGE', 'GROUP_PURCHASE_PACKAGE');

-- CreateEnum
CREATE TYPE "PackageStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SOLD_OUT');

-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('LISTED', 'DELISTED');

-- CreateTable
CREATE TABLE "Package" (
    "id" TEXT NOT NULL,
    "type" "PackageType" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "regularPrice" DECIMAL(10,2) NOT NULL,
    "packagePrice" DECIMAL(10,2) NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "status" "PackageStatus" NOT NULL DEFAULT 'ACTIVE',
    "listingStatus" "ListingStatus" NOT NULL DEFAULT 'LISTED',
    "capacity" INTEGER,
    "soldQuantity" INTEGER NOT NULL DEFAULT 0,
    "purchaseLimitPerCustomer" INTEGER,
    "salesStartAt" TIMESTAMP(3),
    "salesEndAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Package_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackageService" (
    "packageId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,

    CONSTRAINT "PackageService_pkey" PRIMARY KEY ("packageId","serviceId")
);

-- CreateTable
CREATE TABLE "PackageBranch" (
    "packageId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PackageBranch_pkey" PRIMARY KEY ("packageId","branchId")
);

-- CreateTable
CREATE TABLE "PackageImage" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PackageImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PackageService_serviceId_idx" ON "PackageService"("serviceId");

-- CreateIndex
CREATE INDEX "PackageBranch_branchId_idx" ON "PackageBranch"("branchId");

-- CreateIndex
CREATE INDEX "PackageImage_packageId_idx" ON "PackageImage"("packageId");

-- AddForeignKey
ALTER TABLE "PackageService" ADD CONSTRAINT "PackageService_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageService" ADD CONSTRAINT "PackageService_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageBranch" ADD CONSTRAINT "PackageBranch_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageBranch" ADD CONSTRAINT "PackageBranch_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageImage" ADD CONSTRAINT "PackageImage_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE CASCADE ON UPDATE CASCADE;
