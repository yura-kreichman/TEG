-- Уведомление "Новый расход" (запрос владельца 2026-08-15): два независимых
-- тумблера — Telegram/email и Push, по образцу инструктажа и инкассации.

CREATE TABLE "ExpenseSummarySettings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExpenseSummarySettings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExpenseSummarySettings_tenantId_key" ON "ExpenseSummarySettings"("tenantId");

ALTER TABLE "ExpenseSummarySettings"
  ADD CONSTRAINT "ExpenseSummarySettings_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PushNotificationSettings" ADD COLUMN "expense" BOOLEAN NOT NULL DEFAULT true;
