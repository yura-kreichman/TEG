-- AlterTable
ALTER TABLE "Landing" ALTER COLUMN "previewToken" SET DEFAULT gen_random_uuid()::text;

-- AlterTable
ALTER TABLE "MoneyOperation" ADD COLUMN     "settlesOperationId" TEXT;

-- CreateIndex
CREATE INDEX "MoneyOperation_settlesOperationId_idx" ON "MoneyOperation"("settlesOperationId");
