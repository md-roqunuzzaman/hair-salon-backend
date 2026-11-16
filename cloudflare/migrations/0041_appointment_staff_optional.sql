-- v41: nullable staff assignment, preserving appointments and their dependent records.
-- Runs atomically with the migration ledger via storage.transactionSync().
-- Foreign keys stay enabled. Detach nullable payment links and save reviews/images
-- before replacing the parent, so RESTRICT and CASCADE cannot lose related data.
CREATE TABLE "_StaffOptionalPaymentLinks" AS SELECT id, appointmentId FROM Payment WHERE appointmentId IS NOT NULL;
CREATE TABLE "_StaffOptionalReviews" AS SELECT * FROM Review;
CREATE TABLE "_StaffOptionalReviewImages" AS SELECT * FROM ReviewImage;
UPDATE Payment SET appointmentId = NULL WHERE appointmentId IS NOT NULL;
DELETE FROM Review;
CREATE TABLE "_AppointmentStaffOptional" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderNumber" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "staffId" TEXT,
    "serviceId" TEXT,
    "packageId" TEXT,
    "groupPurchaseId" TEXT,
    "bookingMethod" TEXT NOT NULL,
    "appointmentStatus" TEXT NOT NULL,
    "paymentStatus" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "startTime" TEXT NOT NULL,
    "timezone" TEXT,
    "endTime" TEXT NOT NULL,
    "emailScheduleRevision" INTEGER NOT NULL DEFAULT 0,
    "emailPaymentConfirmedAt" DATETIME,
    "price" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'HKD',
    "durationMinutes" INTEGER NOT NULL,
    "itemName" TEXT NOT NULL,
    "itemNameTranslations" JSONB,
    "holdExpiresAt" DATETIME,
    "qrToken" TEXT,
    "qrVerifiedAt" DATETIME,
    "qrVerifiedBy" TEXT,
    "cancellationPolicySnapshot" JSONB,
    "cancellationPolicyVersion" INTEGER,
    "cancellationIdempotencyKey" TEXT,
    "cancellationResult" JSONB,
    "entitlementCancellationOutcome" TEXT,
    "completedAt" DATETIME,
    "completionNotes" TEXT,
    "cancelledAt" DATETIME,
    "cancellationReason" TEXT,
    "noShowAt" DATETIME,
    "noShowReason" TEXT,
    "depositPercentage" BIGINT,
    "depositAmount" BIGINT,
    "remainingAmount" BIGINT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Appointment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Appointment_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Appointment_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Appointment_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Appointment_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Appointment_groupPurchaseId_fkey" FOREIGN KEY ("groupPurchaseId") REFERENCES "GroupPurchase" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Appointment_qrVerifiedBy_fkey" FOREIGN KEY ("qrVerifiedBy") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "_AppointmentStaffOptional" ("id", "orderNumber", "customerId", "branchId", "staffId", "serviceId", "packageId", "groupPurchaseId", "bookingMethod", "appointmentStatus", "paymentStatus", "date", "startTime", "timezone", "endTime", "emailScheduleRevision", "emailPaymentConfirmedAt", "price", "currency", "durationMinutes", "itemName", "itemNameTranslations", "holdExpiresAt", "qrToken", "qrVerifiedAt", "qrVerifiedBy", "cancellationPolicySnapshot", "cancellationPolicyVersion", "cancellationIdempotencyKey", "cancellationResult", "entitlementCancellationOutcome", "completedAt", "completionNotes", "cancelledAt", "cancellationReason", "noShowAt", "noShowReason", "depositPercentage", "depositAmount", "remainingAmount", "createdAt", "updatedAt") SELECT "id", "orderNumber", "customerId", "branchId", "staffId", "serviceId", "packageId", "groupPurchaseId", "bookingMethod", "appointmentStatus", "paymentStatus", "date", "startTime", "timezone", "endTime", "emailScheduleRevision", "emailPaymentConfirmedAt", "price", "currency", "durationMinutes", "itemName", "itemNameTranslations", "holdExpiresAt", "qrToken", "qrVerifiedAt", "qrVerifiedBy", "cancellationPolicySnapshot", "cancellationPolicyVersion", "cancellationIdempotencyKey", "cancellationResult", "entitlementCancellationOutcome", "completedAt", "completionNotes", "cancelledAt", "cancellationReason", "noShowAt", "noShowReason", "depositPercentage", "depositAmount", "remainingAmount", "createdAt", "updatedAt" FROM "Appointment";
DROP TABLE "Appointment";
ALTER TABLE "_AppointmentStaffOptional" RENAME TO "Appointment";
CREATE UNIQUE INDEX "Appointment_orderNumber_key" ON "Appointment"("orderNumber");
CREATE UNIQUE INDEX "Appointment_qrToken_key" ON "Appointment"("qrToken");
CREATE UNIQUE INDEX "Appointment_cancellationIdempotencyKey_key" ON "Appointment"("cancellationIdempotencyKey");
CREATE INDEX "Appointment_customerId_idx" ON "Appointment"("customerId");
CREATE INDEX "Appointment_branchId_idx" ON "Appointment"("branchId");
CREATE INDEX "Appointment_staffId_idx" ON "Appointment"("staffId");
CREATE INDEX "Appointment_serviceId_idx" ON "Appointment"("serviceId");
CREATE INDEX "Appointment_packageId_idx" ON "Appointment"("packageId");
CREATE INDEX "Appointment_groupPurchaseId_idx" ON "Appointment"("groupPurchaseId");
CREATE INDEX "Appointment_date_idx" ON "Appointment"("date");
CREATE INDEX "Appointment_staffId_date_idx" ON "Appointment"("staffId", "date");
CREATE INDEX "Appointment_appointmentStatus_idx" ON "Appointment"("appointmentStatus");
CREATE INDEX "Appointment_paymentStatus_idx" ON "Appointment"("paymentStatus");
CREATE INDEX "Appointment_holdExpiresAt_idx" ON "Appointment"("holdExpiresAt");
UPDATE Payment SET appointmentId = (SELECT appointmentId FROM "_StaffOptionalPaymentLinks" WHERE id = Payment.id) WHERE id IN (SELECT id FROM "_StaffOptionalPaymentLinks");
INSERT INTO Review SELECT * FROM "_StaffOptionalReviews";
INSERT INTO ReviewImage SELECT * FROM "_StaffOptionalReviewImages";
DROP TABLE "_StaffOptionalReviewImages";
DROP TABLE "_StaffOptionalReviews";
DROP TABLE "_StaffOptionalPaymentLinks";
CREATE TRIGGER "money_Appointment_price_INSERT" BEFORE INSERT ON "Appointment" WHEN NEW."price" IS NOT NULL AND (typeof(NEW."price") != 'integer' OR abs(NEW."price") > 9999999999) BEGIN SELECT RAISE(ABORT, 'Money precision exceeded'); END;
CREATE TRIGGER "money_Appointment_price_UPDATE" BEFORE UPDATE ON "Appointment" WHEN NEW."price" IS NOT NULL AND (typeof(NEW."price") != 'integer' OR abs(NEW."price") > 9999999999) BEGIN SELECT RAISE(ABORT, 'Money precision exceeded'); END;
CREATE TRIGGER "money_Appointment_depositPercentage_INSERT" BEFORE INSERT ON "Appointment" WHEN NEW."depositPercentage" IS NOT NULL AND (typeof(NEW."depositPercentage") != 'integer' OR abs(NEW."depositPercentage") > 99999) BEGIN SELECT RAISE(ABORT, 'Money precision exceeded'); END;
CREATE TRIGGER "money_Appointment_depositPercentage_UPDATE" BEFORE UPDATE ON "Appointment" WHEN NEW."depositPercentage" IS NOT NULL AND (typeof(NEW."depositPercentage") != 'integer' OR abs(NEW."depositPercentage") > 99999) BEGIN SELECT RAISE(ABORT, 'Money precision exceeded'); END;
CREATE TRIGGER "money_Appointment_depositAmount_INSERT" BEFORE INSERT ON "Appointment" WHEN NEW."depositAmount" IS NOT NULL AND (typeof(NEW."depositAmount") != 'integer' OR abs(NEW."depositAmount") > 9999999999) BEGIN SELECT RAISE(ABORT, 'Money precision exceeded'); END;
CREATE TRIGGER "money_Appointment_depositAmount_UPDATE" BEFORE UPDATE ON "Appointment" WHEN NEW."depositAmount" IS NOT NULL AND (typeof(NEW."depositAmount") != 'integer' OR abs(NEW."depositAmount") > 9999999999) BEGIN SELECT RAISE(ABORT, 'Money precision exceeded'); END;
CREATE TRIGGER "money_Appointment_remainingAmount_INSERT" BEFORE INSERT ON "Appointment" WHEN NEW."remainingAmount" IS NOT NULL AND (typeof(NEW."remainingAmount") != 'integer' OR abs(NEW."remainingAmount") > 9999999999) BEGIN SELECT RAISE(ABORT, 'Money precision exceeded'); END;
CREATE TRIGGER "money_Appointment_remainingAmount_UPDATE" BEFORE UPDATE ON "Appointment" WHEN NEW."remainingAmount" IS NOT NULL AND (typeof(NEW."remainingAmount") != 'integer' OR abs(NEW."remainingAmount") > 9999999999) BEGIN SELECT RAISE(ABORT, 'Money precision exceeded'); END;
CREATE TRIGGER "required_Appointment_orderNumber_INSERT" BEFORE INSERT ON "Appointment"
WHEN NEW."orderNumber" IS NULL BEGIN
  SELECT RAISE(ABORT, 'NOT NULL constraint failed: Appointment.orderNumber');
END;

CREATE TRIGGER "required_Appointment_orderNumber_UPDATE" BEFORE UPDATE ON "Appointment"
WHEN NEW."orderNumber" IS NULL BEGIN
  SELECT RAISE(ABORT, 'NOT NULL constraint failed: Appointment.orderNumber');
END;

