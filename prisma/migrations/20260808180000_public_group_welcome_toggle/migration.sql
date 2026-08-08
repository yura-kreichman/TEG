-- Тумблер приветствия новых участников группы клиентов (запрос владельца
-- 2026-08-08). DEFAULT true — приветствие работало с самого начала, тумблер
-- нужен чтобы его выключить, поэтому существующие тенанты ничего не замечают.
ALTER TABLE "TenantPublicGroup" ADD COLUMN "welcomeNewMembers" BOOLEAN NOT NULL DEFAULT true;
