-- CreateEnum
CREATE TYPE "QrVerificationRule" AS ENUM ('BEFORE_START_TIME', 'BEFORE_END_TIME');

-- AlterTable
ALTER TABLE "BranchBookingPolicy" ADD COLUMN     "qrVerificationRule" "QrVerificationRule" NOT NULL DEFAULT 'BEFORE_START_TIME';
