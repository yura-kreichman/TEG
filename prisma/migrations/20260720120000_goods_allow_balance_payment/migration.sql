-- Настройки → Система: глобальный тумблер Владельца, разрешена ли клиентам
-- оплата Товаров балансом абонемента (docs/spec/09-goods.md).
ALTER TABLE "Tenant" ADD COLUMN "goodsAllowBalancePayment" BOOLEAN NOT NULL DEFAULT true;
