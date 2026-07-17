-- Тариф "Прибываний" возвращается на уровень ЗОНЫ (как у Счётчиков/Пусков —
-- запрос пользователя 2026-07-17: "здесь действуют те правила и лимит
-- тарифов"), больше не привязан к активу через Tariff.assetId. Вместо этого
-- актив сам ССЫЛАЕТСЯ на один из тарифов зоны (Asset.tariffId) — создаются
-- независимо, привязка делается владельцем отдельно.
--
-- Примечание: удаление Tariff.assetId/её FK/её partial unique index уже
-- выполнено более ранним (частично применённым) прогоном этой миграции —
-- ALTER TABLE ... DROP COLUMN "assetId" каскадом уронил и
-- "Tariff_zoneId_order_active_key" (её условие ссылалось на assetId), эта
-- версия файла воссоздаёт только то, чего сейчас в БД не хватает.

CREATE UNIQUE INDEX "Tariff_zoneId_order_active_key" ON "Tariff"("zoneId", "order") WHERE "deletedAt" IS NULL;

ALTER TABLE "Asset" ADD COLUMN "tariffId" TEXT;
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_tariffId_fkey"
  FOREIGN KEY ("tariffId") REFERENCES "Tariff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
