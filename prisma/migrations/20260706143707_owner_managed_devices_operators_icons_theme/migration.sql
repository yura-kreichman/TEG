-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "iconKey" TEXT;

-- AlterTable
ALTER TABLE "Operator" ADD COLUMN     "avatarUrl" TEXT;

-- AlterTable
ALTER TABLE "Point" ADD COLUMN     "iconKey" TEXT;

-- AlterTable
ALTER TABLE "PointDevice" ADD COLUMN     "revokedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "themeMode" TEXT NOT NULL DEFAULT 'light';

-- AlterTable
ALTER TABLE "Zone" ADD COLUMN     "iconKey" TEXT;
