/*
  Warnings:

  - You are about to drop the column `telegramBotToken` on the `Tenant` table. All the data in the column will be lost.
  - You are about to drop the column `telegramChatId` on the `Tenant` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Tenant" DROP COLUMN "telegramBotToken",
DROP COLUMN "telegramChatId";
