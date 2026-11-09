/*
  Warnings:

  - Made the column `currency` on table `GroupPurchase` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "GroupPurchase" ALTER COLUMN "currency" SET NOT NULL;
