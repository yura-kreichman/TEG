ALTER TABLE "WebhookEvent" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "WebhookEvent_tenantId_idx" ON "WebhookEvent"("tenantId");
