-- AlterTable
ALTER TABLE "TenantPublicGroup"
  ADD COLUMN "announceNewZones" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "announceNewPoints" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "announceNewAssets" BOOLEAN NOT NULL DEFAULT false;
