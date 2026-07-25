-- CreateTable
CREATE TABLE "ZoneExpenseEvent" (
    "id" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "pointId" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "categoryId" TEXT,
    "amount" DECIMAL(10,2) NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ZoneExpenseEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ZoneExpenseEvent_zoneId_createdAt_idx" ON "ZoneExpenseEvent"("zoneId", "createdAt");

-- AddForeignKey
ALTER TABLE "ZoneExpenseEvent" ADD CONSTRAINT "ZoneExpenseEvent_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZoneExpenseEvent" ADD CONSTRAINT "ZoneExpenseEvent_pointId_fkey" FOREIGN KEY ("pointId") REFERENCES "Point"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZoneExpenseEvent" ADD CONSTRAINT "ZoneExpenseEvent_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "Operator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZoneExpenseEvent" ADD CONSTRAINT "ZoneExpenseEvent_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ExpenseCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
