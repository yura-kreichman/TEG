-- Тариф режима "Прибывания" переносится из отдельной модели LaunchPricing в
-- расширенный Tariff (запрос пользователя 2026-07-17: "переиспользовать
-- существующую сущность Tariff"), без истории цен (простое редактирование
-- на месте, как у обычного тарифа) — тариф теперь может принадлежать активу
-- (assetId), не только зоне.

-- AlterTable: новые поля Tariff
ALTER TABLE "Tariff" ADD COLUMN "assetId" TEXT;
ALTER TABLE "Tariff" ADD COLUMN "pricingMode" TEXT;
ALTER TABLE "Tariff" ADD COLUMN "durationMinutes" INTEGER;
ALTER TABLE "Tariff" ADD COLUMN "roundingMode" TEXT;
ALTER TABLE "Tariff" ADD COLUMN "minAmount" DECIMAL(10,2);

ALTER TABLE "Tariff" ADD CONSTRAINT "Tariff_assetId_fkey"
  FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Перестраиваем partial unique index (zoneId, order): теперь только среди
-- тарифов ЗОНЫ (assetId IS NULL) — тарифы активов не участвуют в паре
-- "тариф 1/тариф 2" зоны, у них order всегда 1, что иначе конфликтовало бы
-- между разными активами одной зоны.
DROP INDEX "Tariff_zoneId_order_active_key";
CREATE UNIQUE INDEX "Tariff_zoneId_order_active_key" ON "Tariff"("zoneId", "order") WHERE "deletedAt" IS NULL AND "assetId" IS NULL;

-- Новый partial unique index: не больше одного активного тарифа на актив.
CREATE UNIQUE INDEX "Tariff_assetId_active_key" ON "Tariff"("assetId") WHERE "deletedAt" IS NULL AND "assetId" IS NOT NULL;

-- Переносим действующий (на "сейчас") тариф каждого актива из LaunchPricing
-- в Tariff — история изменений цены сознательно не переносится (решение
-- пользователя 2026-07-17: "убрать историю, простое редактирование").
INSERT INTO "Tariff" (
  "id", "zoneId", "assetId", "name", "price", "order",
  "pricingMode", "durationMinutes", "roundingMode", "minAmount",
  "createdAt", "updatedAt"
)
SELECT
  md5(random()::text || clock_timestamp()::text),
  a."zoneId",
  lp."assetId",
  a."name",
  lp."price",
  1,
  lp."pricingMode",
  lp."durationMinutes",
  lp."roundingMode",
  lp."minAmount",
  now(),
  now()
FROM (
  SELECT DISTINCT ON ("assetId") *
  FROM "LaunchPricing"
  WHERE "effectiveFrom" <= now()
  ORDER BY "assetId", "effectiveFrom" DESC
) lp
JOIN "Asset" a ON a."id" = lp."assetId";

DROP TABLE "LaunchPricing";
