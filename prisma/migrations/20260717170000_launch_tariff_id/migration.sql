-- "Пуски" (accountingMode="launches") — тап по активу сразу учитывает пуск
-- по одному из до-двух тарифов зоны, выбранному оператором (запрос
-- пользователя 2026-07-17). null у "stays".
ALTER TABLE "Launch" ADD COLUMN "tariffId" TEXT;

ALTER TABLE "Launch" ADD CONSTRAINT "Launch_tariffId_fkey"
    FOREIGN KEY ("tariffId") REFERENCES "Tariff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
