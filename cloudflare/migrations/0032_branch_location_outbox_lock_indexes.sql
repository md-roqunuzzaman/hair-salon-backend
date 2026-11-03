-- Add lookup indexes only; retain all existing rows, constraints and history.
CREATE INDEX "Branch_status_latitude_longitude_idx" ON "Branch"("status", "latitude", "longitude");
CREATE INDEX "EmailOutbox_status_lockedUntil_idx" ON "EmailOutbox"("status", "lockedUntil");
