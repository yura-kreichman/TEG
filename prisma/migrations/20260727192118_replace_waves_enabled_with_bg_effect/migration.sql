-- Заменяет Tenant.wavesEnabled (Boolean) на Tenant.bgEffect (String) —
-- вырос из простого тумблера "Волны" в выбор одного эффекта из нескольких
-- (запрос пользователя 2026-07-27). Данные переносятся, не теряются:
-- wavesEnabled = true -> 'waves', false -> 'none'.

ALTER TABLE "Tenant" ADD COLUMN "bgEffect" TEXT NOT NULL DEFAULT 'waves';

UPDATE "Tenant" SET "bgEffect" = CASE WHEN "wavesEnabled" THEN 'waves' ELSE 'none' END;

ALTER TABLE "Tenant" DROP COLUMN "wavesEnabled";
