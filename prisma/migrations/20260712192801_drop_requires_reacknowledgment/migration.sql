/*
  Warnings:

  - You are about to drop the column `requiresReacknowledgment` on the `AcknowledgmentRecord` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "AcknowledgmentRecord" DROP COLUMN "requiresReacknowledgment";
