-- id отправленного Telegram-сообщения "Новый расход" — чтобы правка расхода
-- владельцем (сумма, категория, зона) переписывала уже отправленное
-- сообщение, а не оставляла его врать в чате. Тот же приём и та же причина,
-- что у ZoneSubmission.telegramSummaryMessageId.
ALTER TABLE "MoneyOperation" ADD COLUMN "expenseAlertMessageId" TEXT;
