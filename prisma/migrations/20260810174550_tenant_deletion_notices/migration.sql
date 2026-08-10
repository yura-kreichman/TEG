-- AlterTable
ALTER TABLE "Landing" ALTER COLUMN "previewToken" SET DEFAULT gen_random_uuid()::text;

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "deletionFinalNoticeSentAt" TIMESTAMP(3),
ADD COLUMN     "deletionNoticeSentAt" TIMESTAMP(3);
