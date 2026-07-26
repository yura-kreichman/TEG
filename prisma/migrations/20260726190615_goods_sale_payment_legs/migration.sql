-- CreateTable
CREATE TABLE "GoodsSalePaymentLeg" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "walletId" TEXT,
    "order" INTEGER NOT NULL,

    CONSTRAINT "GoodsSalePaymentLeg_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GoodsSalePaymentLeg_saleId_idx" ON "GoodsSalePaymentLeg"("saleId");

-- CreateIndex
CREATE INDEX "GoodsSalePaymentLeg_walletId_idx" ON "GoodsSalePaymentLeg"("walletId");

-- AddForeignKey
ALTER TABLE "GoodsSalePaymentLeg" ADD CONSTRAINT "GoodsSalePaymentLeg_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "GoodsSale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsSalePaymentLeg" ADD CONSTRAINT "GoodsSalePaymentLeg_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "AbonementWallet"("id") ON DELETE SET NULL ON UPDATE CASCADE;
