-- CreateTable
CREATE TABLE "CounterTapEventPaymentLeg" (
    "id" TEXT NOT NULL,
    "tapId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "walletId" TEXT,
    "order" INTEGER NOT NULL,

    CONSTRAINT "CounterTapEventPaymentLeg_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CounterTapEventPaymentLeg_tapId_idx" ON "CounterTapEventPaymentLeg"("tapId");

-- CreateIndex
CREATE INDEX "CounterTapEventPaymentLeg_walletId_idx" ON "CounterTapEventPaymentLeg"("walletId");

-- AddForeignKey
ALTER TABLE "CounterTapEventPaymentLeg" ADD CONSTRAINT "CounterTapEventPaymentLeg_tapId_fkey" FOREIGN KEY ("tapId") REFERENCES "CounterTapEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CounterTapEventPaymentLeg" ADD CONSTRAINT "CounterTapEventPaymentLeg_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "AbonementWallet"("id") ON DELETE SET NULL ON UPDATE CASCADE;
