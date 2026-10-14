-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "translations" JSONB;

-- AlterTable
ALTER TABLE "Service" ADD COLUMN     "bookingNotes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "isPopular" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "processSteps" TEXT[] DEFAULT ARRAY[]::TEXT[];
