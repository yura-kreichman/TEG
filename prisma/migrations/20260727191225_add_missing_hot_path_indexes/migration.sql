-- AlterTable
ALTER TABLE "Landing" ALTER COLUMN "previewToken" SET DEFAULT gen_random_uuid()::text;

-- CreateIndex
CREATE INDEX "Asset_zoneId_idx" ON "Asset"("zoneId");

-- CreateIndex
CREATE INDEX "Operator_tenantId_idx" ON "Operator"("tenantId");

-- CreateIndex
CREATE INDEX "Point_tenantId_idx" ON "Point"("tenantId");

-- CreateIndex
CREATE INDEX "Zone_pointId_idx" ON "Zone"("pointId");
