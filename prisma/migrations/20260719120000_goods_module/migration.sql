-- AlterTable
ALTER TABLE "AbonementTransaction" ADD COLUMN     "goodsSaleId" TEXT;

-- AlterTable
ALTER TABLE "Operator" ADD COLUMN     "goodsAccess" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "GoodsCategory" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "GoodsCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Goods" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "photoUrl" TEXT,
    "price" DECIMAL(10,2) NOT NULL,
    "lowStockThreshold" INTEGER,
    "trackStock" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Goods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsStock" (
    "id" TEXT NOT NULL,
    "goodsId" TEXT NOT NULL,
    "pointId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "GoodsStock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsRestock" (
    "id" TEXT NOT NULL,
    "goodsId" TEXT NOT NULL,
    "pointId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "performedByUserId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoodsRestock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsSale" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "goodsId" TEXT NOT NULL,
    "pointId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "priceSnapshot" DECIMAL(10,2) NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "paymentMethod" TEXT NOT NULL,
    "walletId" TEXT,
    "performedByOperatorId" TEXT,
    "performedByUserId" TEXT,
    "voidedAt" TIMESTAMP(3),
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoodsSale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsRevision" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "pointId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "performedByOperatorId" TEXT,
    "performedByUserId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoodsRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsRevisionLine" (
    "id" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "goodsId" TEXT NOT NULL,
    "calculatedQuantity" INTEGER NOT NULL,
    "actualQuantity" INTEGER NOT NULL,

    CONSTRAINT "GoodsRevisionLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsReconciliation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "pointId" TEXT NOT NULL,
    "performedByOperatorId" TEXT,
    "performedByUserId" TEXT,
    "actualCash" DECIMAL(10,2) NOT NULL,
    "actualMobile" DECIMAL(10,2) NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoodsReconciliation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GoodsCategory_tenantId_idx" ON "GoodsCategory"("tenantId");

-- CreateIndex
CREATE INDEX "Goods_tenantId_idx" ON "Goods"("tenantId");

-- CreateIndex
CREATE INDEX "Goods_categoryId_idx" ON "Goods"("categoryId");

-- CreateIndex
CREATE INDEX "GoodsStock_pointId_idx" ON "GoodsStock"("pointId");

-- CreateIndex
CREATE UNIQUE INDEX "GoodsStock_goodsId_pointId_key" ON "GoodsStock"("goodsId", "pointId");

-- CreateIndex
CREATE INDEX "GoodsRestock_goodsId_pointId_idx" ON "GoodsRestock"("goodsId", "pointId");

-- CreateIndex
CREATE INDEX "GoodsSale_pointId_occurredAt_idx" ON "GoodsSale"("pointId", "occurredAt");

-- CreateIndex
CREATE INDEX "GoodsSale_goodsId_idx" ON "GoodsSale"("goodsId");

-- CreateIndex
CREATE INDEX "GoodsSale_walletId_idx" ON "GoodsSale"("walletId");

-- CreateIndex
CREATE INDEX "GoodsRevision_pointId_occurredAt_idx" ON "GoodsRevision"("pointId", "occurredAt");

-- CreateIndex
CREATE INDEX "GoodsRevisionLine_revisionId_idx" ON "GoodsRevisionLine"("revisionId");

-- CreateIndex
CREATE INDEX "GoodsReconciliation_pointId_occurredAt_idx" ON "GoodsReconciliation"("pointId", "occurredAt");

-- CreateIndex
CREATE INDEX "AbonementTransaction_goodsSaleId_idx" ON "AbonementTransaction"("goodsSaleId");

-- AddForeignKey
ALTER TABLE "AbonementTransaction" ADD CONSTRAINT "AbonementTransaction_goodsSaleId_fkey" FOREIGN KEY ("goodsSaleId") REFERENCES "GoodsSale"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsCategory" ADD CONSTRAINT "GoodsCategory_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Goods" ADD CONSTRAINT "Goods_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Goods" ADD CONSTRAINT "Goods_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "GoodsCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsStock" ADD CONSTRAINT "GoodsStock_goodsId_fkey" FOREIGN KEY ("goodsId") REFERENCES "Goods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsStock" ADD CONSTRAINT "GoodsStock_pointId_fkey" FOREIGN KEY ("pointId") REFERENCES "Point"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsRestock" ADD CONSTRAINT "GoodsRestock_goodsId_fkey" FOREIGN KEY ("goodsId") REFERENCES "Goods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsRestock" ADD CONSTRAINT "GoodsRestock_pointId_fkey" FOREIGN KEY ("pointId") REFERENCES "Point"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsRestock" ADD CONSTRAINT "GoodsRestock_performedByUserId_fkey" FOREIGN KEY ("performedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsSale" ADD CONSTRAINT "GoodsSale_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsSale" ADD CONSTRAINT "GoodsSale_goodsId_fkey" FOREIGN KEY ("goodsId") REFERENCES "Goods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsSale" ADD CONSTRAINT "GoodsSale_pointId_fkey" FOREIGN KEY ("pointId") REFERENCES "Point"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsSale" ADD CONSTRAINT "GoodsSale_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "AbonementWallet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsSale" ADD CONSTRAINT "GoodsSale_performedByOperatorId_fkey" FOREIGN KEY ("performedByOperatorId") REFERENCES "Operator"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsSale" ADD CONSTRAINT "GoodsSale_performedByUserId_fkey" FOREIGN KEY ("performedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsRevision" ADD CONSTRAINT "GoodsRevision_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsRevision" ADD CONSTRAINT "GoodsRevision_pointId_fkey" FOREIGN KEY ("pointId") REFERENCES "Point"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsRevision" ADD CONSTRAINT "GoodsRevision_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "GoodsCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsRevision" ADD CONSTRAINT "GoodsRevision_performedByOperatorId_fkey" FOREIGN KEY ("performedByOperatorId") REFERENCES "Operator"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsRevision" ADD CONSTRAINT "GoodsRevision_performedByUserId_fkey" FOREIGN KEY ("performedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsRevisionLine" ADD CONSTRAINT "GoodsRevisionLine_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "GoodsRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsRevisionLine" ADD CONSTRAINT "GoodsRevisionLine_goodsId_fkey" FOREIGN KEY ("goodsId") REFERENCES "Goods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReconciliation" ADD CONSTRAINT "GoodsReconciliation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReconciliation" ADD CONSTRAINT "GoodsReconciliation_pointId_fkey" FOREIGN KEY ("pointId") REFERENCES "Point"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReconciliation" ADD CONSTRAINT "GoodsReconciliation_performedByOperatorId_fkey" FOREIGN KEY ("performedByOperatorId") REFERENCES "Operator"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReconciliation" ADD CONSTRAINT "GoodsReconciliation_performedByUserId_fkey" FOREIGN KEY ("performedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
