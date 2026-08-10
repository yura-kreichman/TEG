-- AlterTable
ALTER TABLE "Landing" ALTER COLUMN "previewToken" SET DEFAULT gen_random_uuid()::text;

-- AlterTable
ALTER TABLE "TelegramBindCode" ALTER COLUMN "tenantId" DROP NOT NULL;
