-- CreateIndex
CREATE INDEX "AssetReading_assetId_tariffId_createdAt_idx" ON "AssetReading"("assetId", "tariffId", "createdAt");

-- CreateIndex
CREATE INDEX "MoneyOperation_tenantId_idx" ON "MoneyOperation"("tenantId");

-- CreateIndex
CREATE INDEX "MoneyOperation_resultsSubmissionId_zoneId_idx" ON "MoneyOperation"("resultsSubmissionId", "zoneId");

-- CreateIndex
CREATE INDEX "ResultsSubmission_pointId_submittedAt_idx" ON "ResultsSubmission"("pointId", "submittedAt");
