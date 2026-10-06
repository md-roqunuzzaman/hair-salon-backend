-- CreateEnum
CREATE TYPE "SalonPaymentMethod" AS ENUM ('CASH', 'CARD', 'FPS', 'OTHER');

-- AlterEnum
ALTER TYPE "PaymentProvider" ADD VALUE 'SALON';

-- AlterEnum
ALTER TYPE "PaymentPurpose" ADD VALUE 'APPOINTMENT_REMAINING';

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "salonPaymentMethod" "SalonPaymentMethod";
