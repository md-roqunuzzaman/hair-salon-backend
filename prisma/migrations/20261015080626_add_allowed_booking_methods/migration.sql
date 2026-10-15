-- AlterTable
ALTER TABLE "BranchBookingPolicy" ADD COLUMN     "allowedBookingMethods" "BookingMethod"[] DEFAULT ARRAY['PAY_NOW', 'DEPOSIT', 'RESERVE_NOW']::"BookingMethod"[];
