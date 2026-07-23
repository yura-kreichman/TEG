-- Защита от повторной отправки "Сдачи итогов" при потере связи между
-- успешной обработкой на сервере и получением ответа клиентом (аудит
-- 2026-07-25, финальный проход) — см. комментарий у поля в schema.prisma.
ALTER TABLE "ResultsSubmission" ADD COLUMN "idempotencyKey" TEXT;
CREATE UNIQUE INDEX "ResultsSubmission_idempotencyKey_key" ON "ResultsSubmission"("idempotencyKey");
