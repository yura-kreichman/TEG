-- CreateTable
CREATE TABLE "LaunchPaymentLeg" (
    "id" TEXT NOT NULL,
    "launchId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "walletId" TEXT,
    "order" INTEGER NOT NULL,

    CONSTRAINT "LaunchPaymentLeg_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LaunchPaymentLeg_launchId_idx" ON "LaunchPaymentLeg"("launchId");

-- CreateIndex
CREATE INDEX "LaunchPaymentLeg_walletId_idx" ON "LaunchPaymentLeg"("walletId");

-- AddForeignKey
ALTER TABLE "LaunchPaymentLeg" ADD CONSTRAINT "LaunchPaymentLeg_launchId_fkey" FOREIGN KEY ("launchId") REFERENCES "Launch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaunchPaymentLeg" ADD CONSTRAINT "LaunchPaymentLeg_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "AbonementWallet"("id") ON DELETE SET NULL ON UPDATE CASCADE;
