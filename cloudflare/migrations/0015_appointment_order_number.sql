-- Historical appointments retain NULL; new bookings supply an order number.
ALTER TABLE "Appointment" ADD COLUMN "orderNumber" TEXT;

CREATE UNIQUE INDEX "Appointment_orderNumber_key" ON "Appointment"("orderNumber");
