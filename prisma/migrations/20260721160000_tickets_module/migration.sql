-- AlterTable
ALTER TABLE "Operator" ADD COLUMN     "ticketsAccess" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Zone" ADD COLUMN     "ticketLifetimeDays" INTEGER,
ADD COLUMN     "ticketRedemptionEnabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "AbonementTransaction" ADD COLUMN     "ticketOrderId" TEXT;

-- CreateTable
CREATE TABLE "TicketVariant" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "order" INTEGER NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "TicketVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketOrder" (
    "id" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "paymentMethod" TEXT NOT NULL,
    "walletId" TEXT,
    "totalSnapshot" DECIMAL(10,2) NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "openTicketsCount" INTEGER NOT NULL DEFAULT 0,
    "soldByOperatorId" TEXT NOT NULL,
    "soldAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TicketOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ticket" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "variantNameSnapshot" TEXT NOT NULL,
    "priceSnapshot" DECIMAL(10,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "redeemedAt" TIMESTAMP(3),
    "redeemedByOperatorId" TEXT,
    "voidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TicketVariant_assetId_order_idx" ON "TicketVariant"("assetId", "order");

-- CreateIndex
CREATE INDEX "TicketOrder_zoneId_number_idx" ON "TicketOrder"("zoneId", "number");

-- CreateIndex
CREATE INDEX "TicketOrder_zoneId_openTicketsCount_idx" ON "TicketOrder"("zoneId", "openTicketsCount");

-- CreateIndex
CREATE INDEX "Ticket_orderId_idx" ON "Ticket"("orderId");

-- CreateIndex
CREATE INDEX "Ticket_status_idx" ON "Ticket"("status");

-- CreateIndex
CREATE INDEX "AbonementTransaction_ticketOrderId_idx" ON "AbonementTransaction"("ticketOrderId");

-- AddForeignKey
ALTER TABLE "AbonementTransaction" ADD CONSTRAINT "AbonementTransaction_ticketOrderId_fkey" FOREIGN KEY ("ticketOrderId") REFERENCES "TicketOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketVariant" ADD CONSTRAINT "TicketVariant_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketOrder" ADD CONSTRAINT "TicketOrder_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketOrder" ADD CONSTRAINT "TicketOrder_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "AbonementWallet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketOrder" ADD CONSTRAINT "TicketOrder_soldByOperatorId_fkey" FOREIGN KEY ("soldByOperatorId") REFERENCES "Operator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "TicketOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_redeemedByOperatorId_fkey" FOREIGN KEY ("redeemedByOperatorId") REFERENCES "Operator"("id") ON DELETE SET NULL ON UPDATE CASCADE;
