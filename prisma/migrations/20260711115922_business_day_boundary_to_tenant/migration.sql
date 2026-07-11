-- Переносим "Граница бизнес-дня" с DailyCashSummarySettings на Tenant
-- (docs/spec/05-work-time.md) — значение общетенантное, уже читается и
-- Рабочим временем, не только "Кассой за день". Порядок важен: сначала
-- добавляем колонку с дефолтом, копируем существующие значения, только потом
-- удаляем старую колонку — ни одно значение не теряется.

-- AlterTable: добавить колонку на Tenant
ALTER TABLE "Tenant" ADD COLUMN "businessDayBoundary" TEXT NOT NULL DEFAULT '06:00';

-- Скопировать уже настроенные значения из DailyCashSummarySettings
UPDATE "Tenant" t
SET "businessDayBoundary" = d."businessDayBoundary"
FROM "DailyCashSummarySettings" d
WHERE d."tenantId" = t.id;

-- AlterTable: убрать старую колонку
ALTER TABLE "DailyCashSummarySettings" DROP COLUMN "businessDayBoundary";
