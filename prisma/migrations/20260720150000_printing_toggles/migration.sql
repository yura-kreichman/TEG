-- Модуль печати: переключатель на устройстве ("есть ли тут принтер"),
-- переключатель на зоне ("доступна ли кнопка Печать квитанции" для
-- stays/launches), rich text футер и переключатели шапки на тенанте.
ALTER TABLE "PointDevice" ADD COLUMN "hasPrinter" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Zone" ADD COLUMN "printReceiptEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Tenant" ADD COLUMN "receiptFooterContent" JSONB;
ALTER TABLE "Tenant" ADD COLUMN "receiptShowLogo" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Tenant" ADD COLUMN "receiptShowTenantName" BOOLEAN NOT NULL DEFAULT true;
