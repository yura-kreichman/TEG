-- DropIndex
DROP INDEX "Tariff_zoneId_order_key";

-- CreateIndex
-- Partial unique index — уникальность (zoneId, order) только среди активных
-- тарифов, чтобы освободившийся после soft-delete order-слот можно было
-- переиспользовать новым тарифом (см. schema.prisma, модель Tariff).
-- Обычный (не partial) unique constraint средствами Prisma schema.prisma
-- не выразить, отсюда raw SQL. Для отчётов (нужны и удалённые тарифы) не
-- используется — это только защита целостности активного набора.
CREATE UNIQUE INDEX "Tariff_zoneId_order_active_key" ON "Tariff"("zoneId", "order") WHERE "deletedAt" IS NULL;
