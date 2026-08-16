-- Ручной порядок зон внутри точки (запрос владельца 2026-08-16) — тот же
-- приём, что у Asset.sortOrder.
ALTER TABLE "Zone" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- Бэкфилл: сохраняем текущий видимый порядок (везде это был createdAt asc в
-- пределах точки), иначе после деплоя зоны разом перемешались бы в порядке
-- физических строк таблицы.
WITH ordered AS (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "pointId" ORDER BY "createdAt" ASC) - 1 AS pos
  FROM "Zone"
)
UPDATE "Zone" z SET "sortOrder" = ordered.pos
FROM ordered
WHERE z."id" = ordered."id";

CREATE INDEX "Zone_pointId_sortOrder_idx" ON "Zone"("pointId", "sortOrder");
