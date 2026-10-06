-- AlterEnum
ALTER TYPE "BookingMethod" ADD VALUE 'DEPOSIT';

-- AlterEnum
ALTER TYPE "PaymentPurpose" ADD VALUE 'APPOINTMENT_DEPOSIT';

-- AlterEnum
ALTER TYPE "PaymentStatus" ADD VALUE 'PARTIALLY_PAID';

-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "depositAmount" DECIMAL(10,2),
ADD COLUMN     "depositPercentage" DECIMAL(5,2),
ADD COLUMN     "remainingAmount" DECIMAL(10,2);

-- AlterTable
ALTER TABLE "BranchBookingPolicy" ADD COLUMN     "depositEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "depositPercentage" DECIMAL(5,2),
ALTER COLUMN "slotIntervalMinutes" SET DEFAULT 5;
