-- CreateTable
CREATE TABLE "GoodsHeldOrder" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "pointId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "performedByOperatorId" TEXT,
    "performedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoodsHeldOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsHeldOrderLine" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "goodsId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "priceSnapshot" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "GoodsHeldOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GoodsHeldOrder_pointId_idx" ON "GoodsHeldOrder"("pointId");

-- CreateIndex
CREATE UNIQUE INDEX "GoodsHeldOrder_pointId_number_key" ON "GoodsHeldOrder"("pointId", "number");

-- CreateIndex
CREATE INDEX "GoodsHeldOrderLine_orderId_idx" ON "GoodsHeldOrderLine"("orderId");

-- CreateIndex
CREATE INDEX "GoodsHeldOrderLine_goodsId_idx" ON "GoodsHeldOrderLine"("goodsId");

-- AddForeignKey
ALTER TABLE "GoodsHeldOrder" ADD CONSTRAINT "GoodsHeldOrder_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsHeldOrder" ADD CONSTRAINT "GoodsHeldOrder_pointId_fkey" FOREIGN KEY ("pointId") REFERENCES "Point"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsHeldOrder" ADD CONSTRAINT "GoodsHeldOrder_performedByOperatorId_fkey" FOREIGN KEY ("performedByOperatorId") REFERENCES "Operator"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsHeldOrder" ADD CONSTRAINT "GoodsHeldOrder_performedByUserId_fkey" FOREIGN KEY ("performedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsHeldOrderLine" ADD CONSTRAINT "GoodsHeldOrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "GoodsHeldOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsHeldOrderLine" ADD CONSTRAINT "GoodsHeldOrderLine_goodsId_fkey" FOREIGN KEY ("goodsId") REFERENCES "Goods"("id") ON DELETE CASCADE ON UPDATE CASCADE;
