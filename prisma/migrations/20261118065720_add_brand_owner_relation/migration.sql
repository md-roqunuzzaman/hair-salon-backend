-- AlterTable
ALTER TABLE "Brand" ADD COLUMN     "ownerId" TEXT;

-- CreateIndex
CREATE INDEX "Brand_ownerId_idx" ON "Brand"("ownerId");

-- AddForeignKey
ALTER TABLE "Brand" ADD CONSTRAINT "Brand_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
