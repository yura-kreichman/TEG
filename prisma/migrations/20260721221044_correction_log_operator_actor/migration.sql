-- DropForeignKey
ALTER TABLE "CorrectionLog" DROP CONSTRAINT "CorrectionLog_correctedByUserId_fkey";

-- AlterTable
ALTER TABLE "CorrectionLog" ADD COLUMN     "correctedByOperatorId" TEXT,
ALTER COLUMN "correctedByUserId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "CorrectionLog" ADD CONSTRAINT "CorrectionLog_correctedByUserId_fkey" FOREIGN KEY ("correctedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorrectionLog" ADD CONSTRAINT "CorrectionLog_correctedByOperatorId_fkey" FOREIGN KEY ("correctedByOperatorId") REFERENCES "Operator"("id") ON DELETE SET NULL ON UPDATE CASCADE;

