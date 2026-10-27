/*
  Warnings:

  - Made the column `orderNumber` on table `Appointment` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "Appointment" ALTER COLUMN "orderNumber" SET NOT NULL;
