-- AlterTable
ALTER TABLE "ClientTelegramLink" ADD COLUMN "language" TEXT NOT NULL DEFAULT 'en';

-- AlterTable
ALTER TABLE "TicketOrder" ADD COLUMN "expiryReminderSentAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "TicketOrder_expiresAt_expiryReminderSentAt_idx" ON "TicketOrder"("expiresAt", "expiryReminderSentAt");
