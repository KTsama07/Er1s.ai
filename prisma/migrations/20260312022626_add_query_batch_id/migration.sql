-- AlterTable
ALTER TABLE "Query" ADD COLUMN     "batchId" TEXT;

-- CreateIndex
CREATE INDEX "Query_batchId_idx" ON "Query"("batchId");
