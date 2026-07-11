-- Овердрафт по авансам переезжает с Tenant на Operator (docs/spec/05-work-time.md,
-- фидбек пользователя 2026-07-11) — персональная настройка per-operator,
-- а не общетенантная. Данных для переноса нет: у обоих текущих тенантов
-- значение false (никто ещё не включал через UI), новая колонка на Operator
-- стартует с тем же дефолтом false — эффективное поведение не меняется.
ALTER TABLE "Operator" ADD COLUMN "overdraftAllowed" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Tenant" DROP COLUMN "overdraftAllowed";
