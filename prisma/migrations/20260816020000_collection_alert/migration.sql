-- Сообщение "Инкассация" в Telegram/email (запрос владельца 2026-08-16): до
-- этого инкассация уходила только коротким Push, в чате её не было видно.

CREATE TABLE "CollectionSummarySettings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CollectionSummarySettings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CollectionSummarySettings_tenantId_key" ON "CollectionSummarySettings"("tenantId");

ALTER TABLE "CollectionSummarySettings"
  ADD CONSTRAINT "CollectionSummarySettings_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- id отправленного сообщения — общий для всех строк одной инкассации (общая
-- инкассация точки распадается на долю каждой зоны и пулы товаров/абонементов,
-- а сообщение о ней одно). По нему же правка любой строки находит группу.
ALTER TABLE "MoneyOperation" ADD COLUMN "collectionAlertMessageId" TEXT;
CREATE INDEX "MoneyOperation_collectionAlertMessageId_idx" ON "MoneyOperation"("collectionAlertMessageId");
