-- AlterTable
ALTER TABLE "Package" ADD COLUMN     "applicableFor" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "howToUse" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "purchaseNotice" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "validDays" INTEGER;
