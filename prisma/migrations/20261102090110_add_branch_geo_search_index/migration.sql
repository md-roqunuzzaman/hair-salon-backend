-- CreateIndex
CREATE INDEX "Branch_status_latitude_longitude_idx" ON "Branch"("status", "latitude", "longitude");
