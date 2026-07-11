-- AlterTable
ALTER TABLE "Operator" ADD COLUMN     "timeTrackingMode" TEXT NOT NULL DEFAULT 'manual';

-- AlterTable
ALTER TABLE "Shift" ALTER COLUMN "endAt" DROP NOT NULL;
