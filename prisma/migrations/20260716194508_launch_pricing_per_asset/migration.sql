/*
  Warnings:

  - You are about to drop the column `zoneId` on the `LaunchPricing` table. All the data in the column will be lost.
  - Added the required column `assetId` to the `LaunchPricing` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "LaunchPricing" DROP CONSTRAINT "LaunchPricing_zoneId_fkey";

-- DropIndex
DROP INDEX "LaunchPricing_zoneId_effectiveFrom_idx";

-- AlterTable
ALTER TABLE "LaunchPricing" DROP COLUMN "zoneId",
ADD COLUMN     "assetId" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "LaunchPricing_assetId_effectiveFrom_idx" ON "LaunchPricing"("assetId", "effectiveFrom");

-- AddForeignKey
ALTER TABLE "LaunchPricing" ADD CONSTRAINT "LaunchPricing_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
