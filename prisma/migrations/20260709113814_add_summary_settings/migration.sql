-- CreateTable
CREATE TABLE "ZoneSummarySettings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "showReadings" BOOLEAN NOT NULL DEFAULT true,
    "showDelta" BOOLEAN NOT NULL DEFAULT true,
    "showCash" BOOLEAN NOT NULL DEFAULT true,
    "showCalc" BOOLEAN NOT NULL DEFAULT true,
    "showDiff" BOOLEAN NOT NULL DEFAULT true,
    "showReturns" BOOLEAN NOT NULL DEFAULT true,
    "showOperator" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ZoneSummarySettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyCashSummarySettings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sendMode" TEXT NOT NULL DEFAULT 'event',
    "fixedTime" TEXT NOT NULL DEFAULT '23:00',
    "businessDayBoundary" TEXT NOT NULL DEFAULT '06:00',
    "skipIfNoSubmissions" BOOLEAN NOT NULL DEFAULT true,
    "updateOnLateSubmission" BOOLEAN NOT NULL DEFAULT true,
    "showCash" BOOLEAN NOT NULL DEFAULT true,
    "showExpenses" BOOLEAN NOT NULL DEFAULT true,
    "showZoneBreakdown" BOOLEAN NOT NULL DEFAULT false,
    "showCashOnHand" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyCashSummarySettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftCloseSummarySettings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "showPeriod" BOOLEAN NOT NULL DEFAULT true,
    "showHours" BOOLEAN NOT NULL DEFAULT false,
    "showAdvance" BOOLEAN NOT NULL DEFAULT true,
    "showBonus" BOOLEAN NOT NULL DEFAULT true,
    "showTotal" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShiftCloseSummarySettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ZoneSummarySettings_tenantId_key" ON "ZoneSummarySettings"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "DailyCashSummarySettings_tenantId_key" ON "DailyCashSummarySettings"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "ShiftCloseSummarySettings_tenantId_key" ON "ShiftCloseSummarySettings"("tenantId");

-- AddForeignKey
ALTER TABLE "ZoneSummarySettings" ADD CONSTRAINT "ZoneSummarySettings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyCashSummarySettings" ADD CONSTRAINT "DailyCashSummarySettings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftCloseSummarySettings" ADD CONSTRAINT "ShiftCloseSummarySettings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
