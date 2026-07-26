-- AlterTable
ALTER TABLE "CounterTapEvent" ADD COLUMN "paymentMethod" TEXT;
ALTER TABLE "CounterTapEvent" ADD COLUMN "abonementWalletId" TEXT;

-- AddForeignKey
ALTER TABLE "CounterTapEvent" ADD CONSTRAINT "CounterTapEvent_abonementWalletId_fkey" FOREIGN KEY ("abonementWalletId") REFERENCES "AbonementWallet"("id") ON DELETE SET NULL ON UPDATE CASCADE;
