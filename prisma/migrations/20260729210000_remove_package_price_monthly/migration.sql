-- Цена нигде в RentOS не хранится (решение пользователя 2026-07-29) —
-- единственный источник истины FluentCart, priceMonthly дублировал его и
-- мог разъехаться. "Платный ли пакет" теперь определяется fluentcartProductId
-- (пусто = бесплатный) везде, где раньше проверяли priceMonthly > 0.
ALTER TABLE "Package" DROP COLUMN "priceMonthly";
