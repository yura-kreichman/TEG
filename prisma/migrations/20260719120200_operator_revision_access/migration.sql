-- Отдельный тумблер ревизии остатков, отдельно от goodsAccess (запрос
-- пользователя 2026-07-19). DEFAULT true — уже настроенные операторы не
-- теряют доступ при накатке.
ALTER TABLE "Operator" ADD COLUMN     "revisionAccess" BOOLEAN NOT NULL DEFAULT true;
