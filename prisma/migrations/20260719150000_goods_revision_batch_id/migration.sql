-- Группировка нескольких GoodsRevision (по категории каждая), созданных
-- одним нажатием "Сохранить" в ревизии остатков, в одну запись Истории.
ALTER TABLE "GoodsRevision" ADD COLUMN "batchId" TEXT;

CREATE INDEX "GoodsRevision_batchId_idx" ON "GoodsRevision"("batchId");
