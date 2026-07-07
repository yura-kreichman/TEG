/*
  Warnings:

  - You are about to drop the column `failedPinAttempts` on the `Operator` table. All the data in the column will be lost.
  - You are about to drop the column `pinLockedUntil` on the `Operator` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Operator" DROP COLUMN "failedPinAttempts",
DROP COLUMN "pinLockedUntil";

-- AlterTable
ALTER TABLE "PointDevice" ADD COLUMN     "failedPinAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "pinLockedUntil" TIMESTAMP(3);
