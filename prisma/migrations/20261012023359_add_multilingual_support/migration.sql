-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "itemNameTranslations" JSONB;

-- AlterTable
ALTER TABLE "Branch" ADD COLUMN     "translations" JSONB;

-- AlterTable
ALTER TABLE "Brand" ADD COLUMN     "translations" JSONB;

-- AlterTable
ALTER TABLE "Package" ADD COLUMN     "translations" JSONB;

-- AlterTable
ALTER TABLE "Promotion" ADD COLUMN     "translations" JSONB;

-- AlterTable
ALTER TABLE "Service" ADD COLUMN     "translations" JSONB;

-- AlterTable
ALTER TABLE "Staff" ADD COLUMN     "translations" JSONB;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "preferredLanguage" TEXT NOT NULL DEFAULT 'en';
