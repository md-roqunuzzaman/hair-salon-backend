-- AlterEnum
ALTER TYPE "ReviewModerationStatus" ADD VALUE 'PENDING';

-- AlterTable
ALTER TABLE "Review" ADD COLUMN     "repliedAt" TIMESTAMP(3),
ADD COLUMN     "repliedById" TEXT,
ADD COLUMN     "replyText" TEXT,
ALTER COLUMN "moderationStatus" SET DEFAULT 'PENDING';

-- CreateIndex
CREATE INDEX "Review_repliedById_idx" ON "Review"("repliedById");

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_repliedById_fkey" FOREIGN KEY ("repliedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
