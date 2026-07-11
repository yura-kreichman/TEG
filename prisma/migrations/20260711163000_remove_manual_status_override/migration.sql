-- Убираем Tenant.manualStatusOverride (docs/spec/06-super-admin.md) — по
-- фидбеку пользователя 2026-07-11 ручной оверрайд статуса не нужен: Super
-- Admin уже может выставить subscriptionStatus напрямую через селект на
-- /admin/tenants/[id], отдельный объект-переключатель с причиной был
-- избыточен. Вебхук FluentCart больше не проверяет это поле — просто
-- синхронизирует subscriptionStatus при каждом активирующем/истекающем событии.
ALTER TABLE "Tenant" DROP COLUMN "manualStatusOverride";
