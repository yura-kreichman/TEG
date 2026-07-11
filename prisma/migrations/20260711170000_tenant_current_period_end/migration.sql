-- Информационное поле "действует до" из вебхука FluentCart
-- (subscriptions[].next_billing_date) — не источник правды для логики
-- доступа, только для отображения. См. docs/fluentcart-webhook-schema.md §3.
ALTER TABLE "Tenant" ADD COLUMN "currentPeriodEnd" TIMESTAMP(3);
