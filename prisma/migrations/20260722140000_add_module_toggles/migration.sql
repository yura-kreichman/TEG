-- Настройки → Система, плашка "Модули" (запрос пользователя 2026-07-22) —
-- множественный выбор модулей, которые Владелец может скрыть из интерфейса.
-- default true у всех — у существующих тенантов поведение не меняется молча.
ALTER TABLE "Tenant" ADD COLUMN "instructionsEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Tenant" ADD COLUMN "tasksEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Tenant" ADD COLUMN "landingEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Tenant" ADD COLUMN "goodsEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Tenant" ADD COLUMN "workTimeEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Tenant" ADD COLUMN "clientsEnabled" BOOLEAN NOT NULL DEFAULT true;
