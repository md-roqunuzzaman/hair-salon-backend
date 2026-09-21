-- CreateEnum
CREATE TYPE "ServiceStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateTable
CREATE TABLE "Service" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DECIMAL(10,2) NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "status" "ServiceStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Service_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceImage" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceBranch" (
    "serviceId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceBranch_pkey" PRIMARY KEY ("serviceId","branchId")
);

-- CreateIndex
CREATE INDEX "ServiceImage_serviceId_idx" ON "ServiceImage"("serviceId");

-- CreateIndex
CREATE INDEX "ServiceBranch_branchId_idx" ON "ServiceBranch"("branchId");

-- AddForeignKey
ALTER TABLE "ServiceImage" ADD CONSTRAINT "ServiceImage_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceBranch" ADD CONSTRAINT "ServiceBranch_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceBranch" ADD CONSTRAINT "ServiceBranch_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
