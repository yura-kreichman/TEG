-- CreateTable
CREATE TABLE "InstructionAckSummarySettings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstructionAckSummarySettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InstructionAckSummarySettings_tenantId_key" ON "InstructionAckSummarySettings"("tenantId");

-- AddForeignKey
ALTER TABLE "InstructionAckSummarySettings" ADD CONSTRAINT "InstructionAckSummarySettings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
