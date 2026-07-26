-- AlterTable
ALTER TABLE "Zone" ADD COLUMN "countersTapAssistEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "CounterTapEvent" (
    "id" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "pointId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "tariffId" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CounterTapEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CounterTapEvent_assetId_tariffId_createdAt_idx" ON "CounterTapEvent"("assetId", "tariffId", "createdAt");

-- CreateIndex
CREATE INDEX "CounterTapEvent_zoneId_createdAt_idx" ON "CounterTapEvent"("zoneId", "createdAt");

-- AddForeignKey
ALTER TABLE "CounterTapEvent" ADD CONSTRAINT "CounterTapEvent_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CounterTapEvent" ADD CONSTRAINT "CounterTapEvent_pointId_fkey" FOREIGN KEY ("pointId") REFERENCES "Point"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CounterTapEvent" ADD CONSTRAINT "CounterTapEvent_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CounterTapEvent" ADD CONSTRAINT "CounterTapEvent_tariffId_fkey" FOREIGN KEY ("tariffId") REFERENCES "Tariff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CounterTapEvent" ADD CONSTRAINT "CounterTapEvent_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "Operator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
