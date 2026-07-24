-- CreateTable
CREATE TABLE "ZoneReturnEvent" (
    "id" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "pointId" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ZoneReturnEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ZoneReturnEvent_zoneId_createdAt_idx" ON "ZoneReturnEvent"("zoneId", "createdAt");

-- AddForeignKey
ALTER TABLE "ZoneReturnEvent" ADD CONSTRAINT "ZoneReturnEvent_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZoneReturnEvent" ADD CONSTRAINT "ZoneReturnEvent_pointId_fkey" FOREIGN KEY ("pointId") REFERENCES "Point"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZoneReturnEvent" ADD CONSTRAINT "ZoneReturnEvent_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "Operator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
