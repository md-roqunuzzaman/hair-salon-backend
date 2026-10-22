-- CreateEnum
CREATE TYPE "GroupPurchaseFlow" AS ENUM ('BUY_NOW_BOOK_LATER', 'BUY_NOW_BOOK_NOW');

-- AlterTable
ALTER TABLE "GroupPurchase" ADD COLUMN     "purchaseFlow" "GroupPurchaseFlow" NOT NULL DEFAULT 'BUY_NOW_BOOK_LATER';
