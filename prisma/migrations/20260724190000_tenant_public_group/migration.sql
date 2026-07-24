-- AlterTable
ALTER TABLE "TelegramBindCode" ADD COLUMN "purpose" TEXT NOT NULL DEFAULT 'summary';

-- CreateTable
CREATE TABLE "TenantPublicGroup" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "chatId" TEXT,
    "chatTitle" TEXT,
    "chatStatus" TEXT,
    "inviteLink" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantPublicGroup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TenantPublicGroup_tenantId_key" ON "TenantPublicGroup"("tenantId");

-- AddForeignKey
ALTER TABLE "TenantPublicGroup" ADD CONSTRAINT "TenantPublicGroup_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
