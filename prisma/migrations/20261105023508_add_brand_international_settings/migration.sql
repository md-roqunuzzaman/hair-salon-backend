-- AlterTable
ALTER TABLE "Brand" ADD COLUMN     "countryCode" TEXT NOT NULL DEFAULT 'HK',
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'HKD',
ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'Asia/Hong_Kong';
