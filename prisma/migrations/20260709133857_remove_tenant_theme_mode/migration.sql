-- Theme is no longer a tenant-wide default (per-device only, next-themes localStorage).
ALTER TABLE "Tenant" DROP COLUMN "themeMode";
