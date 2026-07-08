-- DropForeignKey
ALTER TABLE "MoneyOperation" DROP CONSTRAINT "MoneyOperation_zoneId_fkey";

-- AlterTable
ALTER TABLE "MoneyOperation" ADD COLUMN     "beneficiaryOperatorId" TEXT,
ADD COLUMN     "pointId" TEXT,
ADD COLUMN     "shiftId" TEXT,
ALTER COLUMN "zoneId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Operator" ADD COLUMN     "colorTag" TEXT;

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "overdraftAllowed" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "OperatorRate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "rate" DECIMAL(10,2) NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperatorRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shift" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperatorBalanceCarryover" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "comment" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperatorBalanceCarryover_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OperatorRate_operatorId_effectiveFrom_idx" ON "OperatorRate"("operatorId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "Shift_operatorId_startAt_idx" ON "Shift"("operatorId", "startAt");

-- CreateIndex
CREATE INDEX "OperatorBalanceCarryover_operatorId_idx" ON "OperatorBalanceCarryover"("operatorId");

-- CreateIndex
CREATE INDEX "MoneyOperation_beneficiaryOperatorId_type_occurredAt_idx" ON "MoneyOperation"("beneficiaryOperatorId", "type", "occurredAt");

-- CreateIndex
CREATE INDEX "MoneyOperation_pointId_idx" ON "MoneyOperation"("pointId");

-- CreateIndex
CREATE INDEX "MoneyOperation_shiftId_idx" ON "MoneyOperation"("shiftId");

-- AddForeignKey
ALTER TABLE "MoneyOperation" ADD CONSTRAINT "MoneyOperation_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyOperation" ADD CONSTRAINT "MoneyOperation_pointId_fkey" FOREIGN KEY ("pointId") REFERENCES "Point"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyOperation" ADD CONSTRAINT "MoneyOperation_beneficiaryOperatorId_fkey" FOREIGN KEY ("beneficiaryOperatorId") REFERENCES "Operator"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperatorRate" ADD CONSTRAINT "OperatorRate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperatorRate" ADD CONSTRAINT "OperatorRate_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "Operator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "Operator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperatorBalanceCarryover" ADD CONSTRAINT "OperatorBalanceCarryover_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperatorBalanceCarryover" ADD CONSTRAINT "OperatorBalanceCarryover_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "Operator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperatorBalanceCarryover" ADD CONSTRAINT "OperatorBalanceCarryover_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CheckConstraint
-- Ровно одна касса на операцию: zoneId (Счётчики/Деньги) либо pointId
-- (Рабочее время: advance/bonus_payout) — не обе и не ни одной сразу
-- (docs/spec/05-work-time.md, "СТЫК С МОДУЛЕМ ДЕНЬГИ"). Добавлено вручную —
-- Prisma schema language не умеет генерировать многоколоночный CHECK.
ALTER TABLE "MoneyOperation" ADD CONSTRAINT "MoneyOperation_zone_xor_point_check" CHECK (
    ("zoneId" IS NOT NULL AND "pointId" IS NULL) OR ("zoneId" IS NULL AND "pointId" IS NOT NULL)
);
