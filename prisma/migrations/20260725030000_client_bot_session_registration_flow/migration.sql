-- Саморегистрация клиента через бота (запрос пользователя 2026-07-25)
ALTER TABLE "ClientBotSession" ADD COLUMN "pendingRegistrationTenantId" TEXT;
ALTER TABLE "ClientBotSession" ADD COLUMN "pendingRegistrationPhone" TEXT;
ALTER TABLE "ClientBotSession" ADD COLUMN "awaitingRegistrationName" BOOLEAN NOT NULL DEFAULT false;
