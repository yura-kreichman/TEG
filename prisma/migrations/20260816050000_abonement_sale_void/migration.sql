-- Аннулирование продажи абонемента владельцем в реестре продаж
-- (решение владельца 2026-08-16: править нельзя, только удалять).
ALTER TABLE "AbonementTransaction" ADD COLUMN "voidedAt" TIMESTAMP(3);

-- Связь "деньги ↔ пополнение": до сих пор MoneyOperation и
-- AbonementTransaction сходились только по времени/точке, а при разбивке
-- оплаты долю было не сопоставить вовсе.
ALTER TABLE "MoneyOperation" ADD COLUMN "abonementTransactionId" TEXT;
ALTER TABLE "MoneyOperation"
  ADD CONSTRAINT "MoneyOperation_abonementTransactionId_fkey"
  FOREIGN KEY ("abonementTransactionId") REFERENCES "AbonementTransaction"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "MoneyOperation_abonementTransactionId_idx" ON "MoneyOperation"("abonementTransactionId");

-- Бэкфилл для уже существующих продаж: операция оплаты и запись пополнения
-- создаются в ОДНОЙ транзакции, поэтому у настоящей пары createdAt почти
-- совпадает. Сопоставляем в пределах 5 секунд, по той же точке и тому же
-- плану, каждой операции — ближайшую по времени запись; DISTINCT ON не даёт
-- одной транзакции забрать чужую операцию дважды.
WITH matched AS (
  SELECT DISTINCT ON (mo."id") mo."id" AS op_id, at."id" AS tx_id
  FROM "MoneyOperation" mo
  JOIN "AbonementTransaction" at
    ON at."type" = 'topup'
   AND at."voidedAt" IS NULL
   AND at."pointId" IS NOT DISTINCT FROM mo."pointId"
   AND at."abonementId" IS NOT DISTINCT FROM mo."abonementId"
   AND ABS(EXTRACT(EPOCH FROM (at."createdAt" - mo."createdAt"))) <= 5
  WHERE mo."type" IN ('abonement_topup', 'abonement_topup_cashless')
    AND mo."abonementTransactionId" IS NULL
  ORDER BY mo."id", ABS(EXTRACT(EPOCH FROM (at."createdAt" - mo."createdAt")))
)
UPDATE "MoneyOperation" mo
SET "abonementTransactionId" = matched.tx_id
FROM matched
WHERE mo."id" = matched.op_id;
