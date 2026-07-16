-- AlterTable
ALTER TABLE "Zone" ADD COLUMN     "longLaunchThresholdMinutes" INTEGER NOT NULL DEFAULT 60;

-- CreateTable
CREATE TABLE "LaunchPricing" (
    "id" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "pricingMode" TEXT NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "durationMinutes" INTEGER,
    "roundingMode" TEXT,
    "minAmount" DECIMAL(10,2),
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LaunchPricing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Launch" (
    "id" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "assetId" TEXT,
    "number" INTEGER NOT NULL,
    "label" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "isOpen" BOOLEAN NOT NULL DEFAULT true,
    "voidedAt" TIMESTAMP(3),
    "pricingMode" TEXT NOT NULL,
    "priceSnapshot" DECIMAL(10,2) NOT NULL,
    "durationMinutesSnapshot" INTEGER,
    "roundingModeSnapshot" TEXT,
    "minAmountSnapshot" DECIMAL(10,2),
    "amount" DECIMAL(10,2),
    "startedByOperatorId" TEXT,
    "endedByOperatorId" TEXT,
    "zoneSubmissionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Launch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LaunchPricing_zoneId_effectiveFrom_idx" ON "LaunchPricing"("zoneId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "Launch_zoneId_isOpen_idx" ON "Launch"("zoneId", "isOpen");

-- CreateIndex
CREATE INDEX "Launch_zoneId_assetId_number_idx" ON "Launch"("zoneId", "assetId", "number");

-- CreateIndex
CREATE INDEX "Launch_zoneId_endedAt_idx" ON "Launch"("zoneId", "endedAt");

-- CreateIndex
CREATE INDEX "Launch_zoneSubmissionId_idx" ON "Launch"("zoneSubmissionId");

-- AddForeignKey
ALTER TABLE "LaunchPricing" ADD CONSTRAINT "LaunchPricing_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Launch" ADD CONSTRAINT "Launch_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Launch" ADD CONSTRAINT "Launch_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Launch" ADD CONSTRAINT "Launch_startedByOperatorId_fkey" FOREIGN KEY ("startedByOperatorId") REFERENCES "Operator"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Launch" ADD CONSTRAINT "Launch_endedByOperatorId_fkey" FOREIGN KEY ("endedByOperatorId") REFERENCES "Operator"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Launch" ADD CONSTRAINT "Launch_zoneSubmissionId_fkey" FOREIGN KEY ("zoneSubmissionId") REFERENCES "ZoneSubmission"("id") ON DELETE SET NULL ON UPDATE CASCADE;
