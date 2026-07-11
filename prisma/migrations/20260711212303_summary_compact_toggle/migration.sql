-- AlterTable
ALTER TABLE "ShiftCloseSummarySettings" ADD COLUMN     "compact" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ZoneSummarySettings" ADD COLUMN     "compact" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Tariff_zoneId_order_idx" ON "Tariff"("zoneId", "order");
