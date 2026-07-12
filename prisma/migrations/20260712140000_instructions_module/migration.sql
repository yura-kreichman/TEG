-- CreateEnum
CREATE TYPE "InstructionStatus" AS ENUM ('draft', 'published', 'archived');

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "slug" TEXT;

-- CreateTable
CREATE TABLE "Instruction" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "InstructionStatus" NOT NULL DEFAULT 'draft',
    "honestyCheck" BOOLEAN NOT NULL DEFAULT false,
    "title" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "currentVersionNumber" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Instruction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstructionVersion" (
    "id" TEXT NOT NULL,
    "instructionId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InstructionVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcknowledgmentRecord" (
    "id" TEXT NOT NULL,
    "instructionId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "birthDate" TIMESTAMP(3) NOT NULL,
    "signaturePng" BYTEA NOT NULL,
    "readingSeconds" INTEGER NOT NULL,
    "requiresReacknowledgment" BOOLEAN NOT NULL DEFAULT false,
    "ip" TEXT NOT NULL,
    "userAgent" TEXT NOT NULL,
    "deviceLabel" TEXT,
    "browserLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AcknowledgmentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Instruction_tenantId_slug_key" ON "Instruction"("tenantId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "InstructionVersion_instructionId_versionNumber_key" ON "InstructionVersion"("instructionId", "versionNumber");

-- CreateIndex
CREATE INDEX "AcknowledgmentRecord_instructionId_createdAt_idx" ON "AcknowledgmentRecord"("instructionId", "createdAt");

-- CreateIndex
CREATE INDEX "AcknowledgmentRecord_instructionId_ip_createdAt_idx" ON "AcknowledgmentRecord"("instructionId", "ip", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");

-- AddForeignKey
ALTER TABLE "Instruction" ADD CONSTRAINT "Instruction_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstructionVersion" ADD CONSTRAINT "InstructionVersion_instructionId_fkey" FOREIGN KEY ("instructionId") REFERENCES "Instruction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcknowledgmentRecord" ADD CONSTRAINT "AcknowledgmentRecord_instructionId_fkey" FOREIGN KEY ("instructionId") REFERENCES "Instruction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcknowledgmentRecord" ADD CONSTRAINT "AcknowledgmentRecord_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "InstructionVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

