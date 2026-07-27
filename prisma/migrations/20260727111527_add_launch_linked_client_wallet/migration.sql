-- AlterTable
ALTER TABLE "Launch" ADD COLUMN     "linkedClientWalletId" TEXT;

-- AddForeignKey
ALTER TABLE "Launch" ADD CONSTRAINT "Launch_linkedClientWalletId_fkey" FOREIGN KEY ("linkedClientWalletId") REFERENCES "AbonementWallet"("id") ON DELETE SET NULL ON UPDATE CASCADE;
