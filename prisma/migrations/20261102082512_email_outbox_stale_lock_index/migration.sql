-- CreateIndex
CREATE INDEX "EmailOutbox_status_lockedUntil_idx" ON "EmailOutbox"("status", "lockedUntil");
