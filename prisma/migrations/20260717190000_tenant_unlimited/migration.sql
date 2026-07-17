-- Ручной оверрайд Super Admin'ом "пакет Unlimited без ограничений" (запрос
-- пользователя 2026-07-17) — снимает все 4 лимита разом, не покупаемый
-- пакет, не строка в Package, только рубильник на самом Tenant. См.
-- getTenantLimits() в src/lib/packages.ts.
ALTER TABLE "Tenant" ADD COLUMN "unlimited" BOOLEAN NOT NULL DEFAULT false;
