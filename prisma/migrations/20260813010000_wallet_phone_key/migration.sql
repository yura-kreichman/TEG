-- Ключ сопоставления кошелька по хвосту номера (решение пользователя
-- 2026-08-12). Зачем именно хвост и почему 8 цифр — в комментарии у поля
-- AbonementWallet.phoneKey в schema.prisma.
--
-- Добавляем с DEFAULT '', сразу пересчитываем по существующим номерам и
-- только потом снимаем дефолт: иначе NOT NULL не наложить на непустую
-- таблицу. RIGHT() короче длины строки возвращает строку целиком — короткие
-- номера (введённые без кода страны) корректно дают сами себя.
ALTER TABLE "AbonementWallet" ADD COLUMN "phoneKey" TEXT NOT NULL DEFAULT '';

UPDATE "AbonementWallet" SET "phoneKey" = RIGHT("phone", 8);

ALTER TABLE "AbonementWallet" ALTER COLUMN "phoneKey" DROP DEFAULT;

CREATE INDEX "AbonementWallet_tenantId_phoneKey_idx" ON "AbonementWallet"("tenantId", "phoneKey");
