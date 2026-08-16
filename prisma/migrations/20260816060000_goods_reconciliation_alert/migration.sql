-- Уведомление о сдаче кассы Товаров (запрос владельца 2026-08-16):
-- Telegram + Push, со своим тумблером, как у расходов и инкассаций.
ALTER TABLE "GoodsReconciliation" ADD COLUMN "alertMessageId" TEXT;

ALTER TABLE "PushNotificationSettings" ADD COLUMN "goods" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "GoodsSummarySettings" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GoodsSummarySettings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GoodsSummarySettings_tenantId_key" ON "GoodsSummarySettings"("tenantId");

ALTER TABLE "GoodsSummarySettings"
  ADD CONSTRAINT "GoodsSummarySettings_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
