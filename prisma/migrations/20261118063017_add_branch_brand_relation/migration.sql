-- AlterTable
ALTER TABLE "Branch" ADD COLUMN     "brandId" TEXT;

-- CreateIndex
CREATE INDEX "Branch_brandId_idx" ON "Branch"("brandId");

-- AddForeignKey
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
