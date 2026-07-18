-- Реальные деньги за конкретный план продажи абонемента (запрос
-- пользователя 2026-07-18): без этого поля сумма по плану считалась по
-- ТЕКУЩЕЙ цене плана вместо реально уплаченной — расходилась с итоговой
-- суммой, если цену плана меняли после продажи.
ALTER TABLE "MoneyOperation" ADD COLUMN "abonementId" TEXT;
ALTER TABLE "MoneyOperation" ADD CONSTRAINT "MoneyOperation_abonementId_fkey" FOREIGN KEY ("abonementId") REFERENCES "Abonement"("id") ON DELETE SET NULL ON UPDATE CASCADE;
