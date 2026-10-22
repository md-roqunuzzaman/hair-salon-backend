-- AlterTable
ALTER TABLE "GroupPurchase" ADD COLUMN     "bookingMethod" "BookingMethod",
ADD COLUMN     "depositAmount" DECIMAL(10,2),
ADD COLUMN     "depositPercentage" DECIMAL(5,2),
ADD COLUMN     "remainingAmount" DECIMAL(10,2);
