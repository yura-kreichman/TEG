-- Защита от переупорядоченной доставки вебхуков FluentCart (аудит
-- 2026-07-25) — см. комментарий у поля в schema.prisma и у
-- syncTenantFromFluentCartEvent в src/lib/fluentcart-webhook.ts.
ALTER TABLE "Tenant" ADD COLUMN "lastFluentcartEventAt" TIMESTAMP(3);
