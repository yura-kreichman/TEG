-- CreateEnum
CREATE TYPE "SummaryChannelType" AS ENUM ('telegram', 'email');

-- CreateTable
CREATE TABLE "TenantSummaryChannel" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "channelType" "SummaryChannelType" NOT NULL,
    "pointId" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "chatId" TEXT,
    "chatTitle" TEXT,
    "chatStatus" TEXT,
    "emailAddresses" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantSummaryChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelegramBindCode" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "pointId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelegramBindCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TenantSummaryChannel_tenantId_channelType_idx" ON "TenantSummaryChannel"("tenantId", "channelType");

-- CreateIndex
CREATE INDEX "TenantSummaryChannel_chatId_idx" ON "TenantSummaryChannel"("chatId");

-- CreateIndex
CREATE UNIQUE INDEX "TelegramBindCode_code_key" ON "TelegramBindCode"("code");

-- CreateIndex
CREATE INDEX "TelegramBindCode_tenantId_idx" ON "TelegramBindCode"("tenantId");

-- AddForeignKey
ALTER TABLE "TenantSummaryChannel" ADD CONSTRAINT "TenantSummaryChannel_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantSummaryChannel" ADD CONSTRAINT "TenantSummaryChannel_pointId_fkey" FOREIGN KEY ("pointId") REFERENCES "Point"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelegramBindCode" ADD CONSTRAINT "TelegramBindCode_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
