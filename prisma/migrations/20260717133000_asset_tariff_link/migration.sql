-- Тариф "Прибываний" возвращается на уровень ЗОНЫ (как у Счётчиков/Пусков —
-- запрос пользователя 2026-07-17: "здесь действуют те правила и лимит
-- тарифов"), больше не привязан к активу через Tariff.assetId. Вместо этого
-- актив сам ССЫЛАЕТСЯ на один из тарифов зоны (Asset.tariffId) — создаются
-- независимо, привязка делается владельцем отдельно.
--
-- Исправлено 2026-07-17 после реального сбоя на проде (P3009): предыдущая
-- версия файла ошибочно предполагала, что DROP COLUMN "assetId" уже выполнен
-- более ранним прогоном — на деле вся транзакция того прогона откатилась
-- целиком (упала на другом шаге), колонка осталась на месте, и CREATE UNIQUE
-- INDEX здесь падал с "already exists" (индекс с assetId в условии всё ещё
-- жил). Явно дропаем всё, что зависит от assetId, ПЕРЕД пересозданием — с
-- IF EXISTS/IF NOT EXISTS, чтобы файл можно было безопасно повторить.
ALTER TABLE "Tariff" DROP CONSTRAINT IF EXISTS "Tariff_assetId_fkey";
DROP INDEX IF EXISTS "Tariff_assetId_active_key";
DROP INDEX IF EXISTS "Tariff_zoneId_order_active_key";
ALTER TABLE "Tariff" DROP COLUMN IF EXISTS "assetId";

CREATE UNIQUE INDEX "Tariff_zoneId_order_active_key" ON "Tariff"("zoneId", "order") WHERE "deletedAt" IS NULL;

ALTER TABLE "Asset" ADD COLUMN IF NOT EXISTS "tariffId" TEXT;
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_tariffId_fkey"
  FOREIGN KEY ("tariffId") REFERENCES "Tariff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
