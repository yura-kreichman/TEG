-- DropForeignKey
ALTER TABLE "AssetReading" DROP CONSTRAINT "AssetReading_assetId_fkey";

-- DropForeignKey
ALTER TABLE "AssetReading" DROP CONSTRAINT "AssetReading_tariffId_fkey";

-- DropForeignKey
ALTER TABLE "CounterTapEvent" DROP CONSTRAINT "CounterTapEvent_operatorId_fkey";

-- DropForeignKey
ALTER TABLE "Goods" DROP CONSTRAINT "Goods_categoryId_fkey";

-- DropForeignKey
ALTER TABLE "GoodsRestock" DROP CONSTRAINT "GoodsRestock_goodsId_fkey";

-- DropForeignKey
ALTER TABLE "GoodsRestock" DROP CONSTRAINT "GoodsRestock_performedByUserId_fkey";

-- DropForeignKey
ALTER TABLE "GoodsRevision" DROP CONSTRAINT "GoodsRevision_categoryId_fkey";

-- DropForeignKey
ALTER TABLE "GoodsSale" DROP CONSTRAINT "GoodsSale_goodsId_fkey";

-- DropForeignKey
ALTER TABLE "GoodsStock" DROP CONSTRAINT "GoodsStock_goodsId_fkey";

-- DropForeignKey
ALTER TABLE "OperatorBalanceCarryover" DROP CONSTRAINT "OperatorBalanceCarryover_createdByUserId_fkey";

-- DropForeignKey
ALTER TABLE "Shift" DROP CONSTRAINT "Shift_pointId_fkey";

-- DropForeignKey
ALTER TABLE "Task" DROP CONSTRAINT "Task_createdByUserId_fkey";

-- DropForeignKey
ALTER TABLE "Ticket" DROP CONSTRAINT "Ticket_assetId_fkey";

-- DropForeignKey
ALTER TABLE "ZoneExpenseEvent" DROP CONSTRAINT "ZoneExpenseEvent_operatorId_fkey";

-- DropForeignKey
ALTER TABLE "ZoneReturnEvent" DROP CONSTRAINT "ZoneReturnEvent_operatorId_fkey";

-- DropForeignKey
ALTER TABLE "ZoneSubmission" DROP CONSTRAINT "ZoneSubmission_zoneId_fkey";

-- AddForeignKey
ALTER TABLE "ZoneReturnEvent" ADD CONSTRAINT "ZoneReturnEvent_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "Operator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZoneExpenseEvent" ADD CONSTRAINT "ZoneExpenseEvent_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "Operator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CounterTapEvent" ADD CONSTRAINT "CounterTapEvent_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "Operator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Goods" ADD CONSTRAINT "Goods_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "GoodsCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsStock" ADD CONSTRAINT "GoodsStock_goodsId_fkey" FOREIGN KEY ("goodsId") REFERENCES "Goods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsRestock" ADD CONSTRAINT "GoodsRestock_goodsId_fkey" FOREIGN KEY ("goodsId") REFERENCES "Goods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsRestock" ADD CONSTRAINT "GoodsRestock_performedByUserId_fkey" FOREIGN KEY ("performedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsSale" ADD CONSTRAINT "GoodsSale_goodsId_fkey" FOREIGN KEY ("goodsId") REFERENCES "Goods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsRevision" ADD CONSTRAINT "GoodsRevision_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "GoodsCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZoneSubmission" ADD CONSTRAINT "ZoneSubmission_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetReading" ADD CONSTRAINT "AssetReading_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetReading" ADD CONSTRAINT "AssetReading_tariffId_fkey" FOREIGN KEY ("tariffId") REFERENCES "Tariff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_pointId_fkey" FOREIGN KEY ("pointId") REFERENCES "Point"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperatorBalanceCarryover" ADD CONSTRAINT "OperatorBalanceCarryover_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
