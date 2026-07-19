-- Оплата поездки балансом на активе режима "Счётчики" (docs/spec/01-counters.md)
-- — независимая ручная фиксация Сотрудником, не связанная с самим тиком
-- счётчика (RFID тикает физически, программа об этом не знает).
ALTER TABLE "AbonementTransaction" ADD COLUMN "assetId" TEXT;
ALTER TABLE "AbonementTransaction" ADD COLUMN "tariffId" TEXT;

ALTER TABLE "AbonementTransaction" ADD CONSTRAINT "AbonementTransaction_assetId_fkey"
  FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AbonementTransaction" ADD CONSTRAINT "AbonementTransaction_tariffId_fkey"
  FOREIGN KEY ("tariffId") REFERENCES "Tariff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "AbonementTransaction_assetId_idx" ON "AbonementTransaction"("assetId");
