ALTER TYPE "SubscriptionStatus" ADD VALUE 'suspended';

ALTER TABLE "Package" ADD COLUMN "fluentcartProductId" TEXT;
CREATE UNIQUE INDEX "Package_fluentcartProductId_key" ON "Package"("fluentcartProductId");

ALTER TABLE "Tenant" ADD COLUMN "fluentcartCustomerId" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "manualStatusOverride" JSONB;
ALTER TABLE "Tenant" ADD COLUMN "limitOverrides" JSONB;
CREATE UNIQUE INDEX "Tenant_fluentcartCustomerId_key" ON "Tenant"("fluentcartCustomerId");

CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SystemSettings" (
    "id" TEXT NOT NULL,
    "config" JSONB NOT NULL,

    CONSTRAINT "SystemSettings_pkey" PRIMARY KEY ("id")
);
