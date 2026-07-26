-- CreateTable
CREATE TABLE "TicketOrderPaymentLeg" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "walletId" TEXT,
    "order" INTEGER NOT NULL,

    CONSTRAINT "TicketOrderPaymentLeg_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TicketOrderPaymentLeg_orderId_idx" ON "TicketOrderPaymentLeg"("orderId");

-- CreateIndex
CREATE INDEX "TicketOrderPaymentLeg_walletId_idx" ON "TicketOrderPaymentLeg"("walletId");

-- AddForeignKey
ALTER TABLE "TicketOrderPaymentLeg" ADD CONSTRAINT "TicketOrderPaymentLeg_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "TicketOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketOrderPaymentLeg" ADD CONSTRAINT "TicketOrderPaymentLeg_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "AbonementWallet"("id") ON DELETE SET NULL ON UPDATE CASCADE;
