-- CreateTable
CREATE TABLE "DailyCashSummaryDelivery" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "pointId" TEXT NOT NULL,
    "businessDate" TIMESTAMP(3) NOT NULL,
    "channelType" "SummaryChannelType" NOT NULL,
    "externalMessageId" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyCashSummaryDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DailyCashSummaryDelivery_pointId_businessDate_channelType_key" ON "DailyCashSummaryDelivery"("pointId", "businessDate", "channelType");

-- AddForeignKey
ALTER TABLE "DailyCashSummaryDelivery" ADD CONSTRAINT "DailyCashSummaryDelivery_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyCashSummaryDelivery" ADD CONSTRAINT "DailyCashSummaryDelivery_pointId_fkey" FOREIGN KEY ("pointId") REFERENCES "Point"("id") ON DELETE CASCADE ON UPDATE CASCADE;
