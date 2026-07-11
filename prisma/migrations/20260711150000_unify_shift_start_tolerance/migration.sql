ALTER TABLE "Tenant" ADD COLUMN "earlyToleranceMinutes" INTEGER NOT NULL DEFAULT 120;
ALTER TABLE "Tenant" ADD COLUMN "lateToleranceMinutes" INTEGER NOT NULL DEFAULT 120;

UPDATE "Tenant" SET
  "earlyToleranceMinutes" = GREATEST("autoEarlyToleranceMinutes", "manualEarlyToleranceMinutes"),
  "lateToleranceMinutes" = GREATEST("autoLateToleranceMinutes", "manualLateToleranceMinutes");

ALTER TABLE "Tenant" DROP COLUMN "autoEarlyToleranceMinutes";
ALTER TABLE "Tenant" DROP COLUMN "autoLateToleranceMinutes";
ALTER TABLE "Tenant" DROP COLUMN "manualEarlyToleranceMinutes";
ALTER TABLE "Tenant" DROP COLUMN "manualLateToleranceMinutes";
