-- Тумблер «Доступ техподдержки» в Настройках владельца (запрос владельца
-- 2026-08-23): разрешён ли платформенной техподдержке вход в кабинет через
-- Impersonate. default true — у существующих тенантов доступ остаётся
-- открытым, как было до этой настройки.
ALTER TABLE "Tenant" ADD COLUMN "supportAccessEnabled" BOOLEAN NOT NULL DEFAULT true;
