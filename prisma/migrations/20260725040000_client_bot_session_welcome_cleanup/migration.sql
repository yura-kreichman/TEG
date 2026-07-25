-- Удаление приветствия в группе клиентов после перехода (запрос пользователя 2026-07-25)
ALTER TABLE "ClientBotSession" ADD COLUMN "pendingWelcomeGroupChatId" TEXT;
ALTER TABLE "ClientBotSession" ADD COLUMN "pendingWelcomeMessageId" TEXT;
