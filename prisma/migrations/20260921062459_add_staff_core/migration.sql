-- CreateEnum
CREATE TYPE "StaffStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Staff" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "roleTitle" TEXT NOT NULL,
    "specialization" TEXT,
    "description" TEXT,
    "avatarObjectKey" TEXT,
    "status" "StaffStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffBranch" (
    "staffId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffBranch_pkey" PRIMARY KEY ("staffId","branchId")
);

-- CreateTable
CREATE TABLE "StaffService" (
    "staffId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffService_pkey" PRIMARY KEY ("staffId","serviceId")
);

-- CreateTable
CREATE TABLE "StaffPackage" (
    "staffId" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffPackage_pkey" PRIMARY KEY ("staffId","packageId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Staff_userId_key" ON "Staff"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Staff_email_key" ON "Staff"("email");

-- CreateIndex
CREATE INDEX "StaffBranch_branchId_idx" ON "StaffBranch"("branchId");

-- CreateIndex
CREATE INDEX "StaffService_serviceId_idx" ON "StaffService"("serviceId");

-- CreateIndex
CREATE INDEX "StaffPackage_packageId_idx" ON "StaffPackage"("packageId");

-- AddForeignKey
ALTER TABLE "Staff" ADD CONSTRAINT "Staff_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffBranch" ADD CONSTRAINT "StaffBranch_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffBranch" ADD CONSTRAINT "StaffBranch_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffService" ADD CONSTRAINT "StaffService_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffService" ADD CONSTRAINT "StaffService_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffPackage" ADD CONSTRAINT "StaffPackage_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffPackage" ADD CONSTRAINT "StaffPackage_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE CASCADE ON UPDATE CASCADE;
