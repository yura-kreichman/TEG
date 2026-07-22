-- CreateTable
CREATE TABLE "ClientTelegramLink" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientTelegramLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientBotSession" (
    "chatId" TEXT NOT NULL,
    "pendingTenantId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientBotSession_pkey" PRIMARY KEY ("chatId")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClientTelegramLink_tenantId_chatId_key" ON "ClientTelegramLink"("tenantId", "chatId");

-- CreateIndex
CREATE INDEX "ClientTelegramLink_chatId_idx" ON "ClientTelegramLink"("chatId");

-- AddForeignKey
ALTER TABLE "ClientTelegramLink" ADD CONSTRAINT "ClientTelegramLink_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
