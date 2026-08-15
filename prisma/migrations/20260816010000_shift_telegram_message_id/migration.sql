-- id отправленной Telegram-сводки "Закрытие смены" — чтобы правка смены или
-- привязанных к ней аванса/премии переписывала уже отправленное сообщение
-- (требование владельца 2026-08-16: любые правки редактируют сообщения в
-- Telegram). Тот же приём, что ZoneSubmission.telegramSummaryMessageId.
ALTER TABLE "Shift" ADD COLUMN "telegramSummaryMessageId" TEXT;
