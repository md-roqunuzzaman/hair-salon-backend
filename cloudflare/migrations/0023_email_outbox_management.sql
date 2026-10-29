ALTER TABLE "Appointment" ADD COLUMN "emailScheduleRevision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "EmailOutbox" ADD COLUMN "validationData" JSONB;
ALTER TABLE "EmailOutbox" ADD COLUMN "skipReason" TEXT;
ALTER TABLE "EmailOutbox" ADD COLUMN "terminalAt" DATETIME;
CREATE TABLE "EmailOutboxHistory" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "outboxId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "attempt" INTEGER NOT NULL,
  "code" TEXT,
  "provider" TEXT,
  "actorId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmailOutboxHistory_outboxId_fkey" FOREIGN KEY ("outboxId") REFERENCES "EmailOutbox" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "EmailOutboxHistory_outboxId_createdAt_id_idx" ON "EmailOutboxHistory"("outboxId", "createdAt", "id");
CREATE UNIQUE INDEX "EmailOutboxHistory_outboxId_sequence_key" ON "EmailOutboxHistory"("outboxId", "sequence");
