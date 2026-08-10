-- AlterTable
ALTER TABLE "Landing" ALTER COLUMN "previewToken" SET DEFAULT gen_random_uuid()::text;

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "subscriptionCanceledAt" TIMESTAMP(3);
