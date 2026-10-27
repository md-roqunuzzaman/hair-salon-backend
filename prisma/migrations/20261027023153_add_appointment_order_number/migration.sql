/*
  Warnings:

  - A unique constraint covering the columns `[orderNumber]` on the table `Appointment` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "orderNumber" VARCHAR(6);

-- CreateIndex
CREATE UNIQUE INDEX "Appointment_orderNumber_key" ON "Appointment"("orderNumber");
