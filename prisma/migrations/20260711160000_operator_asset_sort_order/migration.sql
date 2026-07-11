ALTER TABLE "Operator" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Asset" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;

WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY "tenantId" ORDER BY "createdAt" ASC) - 1 AS rn
  FROM "Operator"
)
UPDATE "Operator" o SET "sortOrder" = ranked.rn FROM ranked WHERE ranked.id = o.id;

WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY "zoneId" ORDER BY "createdAt" ASC) - 1 AS rn
  FROM "Asset"
)
UPDATE "Asset" a SET "sortOrder" = ranked.rn FROM ranked WHERE ranked.id = a.id;
