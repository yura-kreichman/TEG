-- AlterTable
ALTER TABLE "GoodsHeldOrder" ADD COLUMN     "linkedClientWalletId" TEXT;

-- AddForeignKey
ALTER TABLE "GoodsHeldOrder" ADD CONSTRAINT "GoodsHeldOrder_linkedClientWalletId_fkey" FOREIGN KEY ("linkedClientWalletId") REFERENCES "AbonementWallet"("id") ON DELETE SET NULL ON UPDATE CASCADE;
