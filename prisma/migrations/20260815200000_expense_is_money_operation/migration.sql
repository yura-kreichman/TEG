-- Расход признаётся в момент ввода Сотрудником, а не на сдаче итогов
-- (решение пользователя 2026-08-15). Категория переезжает на саму операцию,
-- обе таблицы-посредника уходят:
--   ZoneExpenseEvent — журнал "внесено, но ещё не учтено";
--   ExpenseEntry     — копия суммы/комментария операции ради одной категории.

-- 1. Категория — прямо на операции журнала.
ALTER TABLE "MoneyOperation" ADD COLUMN "expenseCategoryId" TEXT;

-- 2. Бэкфилл категорий из ExpenseEntry. Пара "операция ↔ запись" однозначна
-- по сдаче+зоне+сумме+комментарию: обе строки создавались одной транзакцией
-- сдачи итогов из одного и того же события. DISTINCT ON защищает от края,
-- где в одной сдаче две одинаковые строки расхода (тогда категория берётся
-- у первой — суммы и так равны, различить их нечем и незачем).
UPDATE "MoneyOperation" mo
SET "expenseCategoryId" = src."categoryId"
FROM (
  SELECT DISTINCT ON (zs."resultsSubmissionId", zs."zoneId", ee."amount", COALESCE(ee."comment", ''))
         zs."resultsSubmissionId" AS rsid,
         zs."zoneId"              AS zid,
         ee."amount"              AS amount,
         ee."comment"             AS comment,
         ee."categoryId"          AS "categoryId"
  FROM "ExpenseEntry" ee
  JOIN "ZoneSubmission" zs ON zs."id" = ee."zoneSubmissionId"
  WHERE ee."categoryId" IS NOT NULL
  ORDER BY zs."resultsSubmissionId", zs."zoneId", ee."amount", COALESCE(ee."comment", ''), ee."createdAt"
) src
WHERE mo."type" = 'expense'
  AND mo."resultsSubmissionId" = src.rsid
  AND mo."zoneId" = src.zid
  AND mo."amount" = -src.amount
  AND COALESCE(mo."comment", '') = COALESCE(src.comment, '');

-- 3. Расходы, внесённые Сотрудником, но ещё не вошедшие ни в одну сдачу,
-- становятся полноценными операциями с resultsSubmissionId = NULL. pointId у
-- операции не заполняется: CHECK-констрейнт требует ровно одно из
-- zoneId/pointId, точка выводится через зону.
INSERT INTO "MoneyOperation" (
  "id", "tenantId", "zoneId", "type", "amount",
  "performedByOperatorId", "comment", "expenseCategoryId", "occurredAt", "createdAt"
)
SELECT
  e."id",
  p."tenantId",
  e."zoneId",
  'expense',
  -e."amount",
  e."operatorId",
  e."comment",
  e."categoryId",
  e."createdAt",
  e."createdAt"
FROM "ZoneExpenseEvent" e
JOIN "Point" p ON p."id" = e."pointId";

ALTER TABLE "MoneyOperation"
  ADD CONSTRAINT "MoneyOperation_expenseCategoryId_fkey"
  FOREIGN KEY ("expenseCategoryId") REFERENCES "ExpenseCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "MoneyOperation_expenseCategoryId_idx" ON "MoneyOperation"("expenseCategoryId");

DROP TABLE "ZoneExpenseEvent";
DROP TABLE "ExpenseEntry";
