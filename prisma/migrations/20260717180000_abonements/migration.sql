-- Модуль "Абонементы" (запрос пользователя 2026-07-17) — внутренний
-- кошелёк клиента (номер телефона), пополняемый с бонусом по абонементам
-- (тариф-планам) владельца, как способ оплаты пуска на "Прибываниях"/
-- "Пусках" наравне с наличными/безналом. Баланс общий на весь тенант, не
-- по точкам. Абонемент = тариф-план ("заплатить → зачислить"), кошелёк
-- клиента — AbonementWallet, появляется только как побочный эффект покупки
-- плана оператором (владелец не создаёт кошельки вручную — уточнение того
-- же дня).

-- CreateTable
CREATE TABLE "Abonement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT,
    "price" DECIMAL(10,2) NOT NULL,
    "creditAmount" DECIMAL(10,2) NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Abonement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AbonementWallet" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT,
    "balance" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AbonementWallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AbonementTransaction" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "abonementId" TEXT,
    "paymentMethod" TEXT,
    "launchId" TEXT,
    "pointId" TEXT,
    "operatorId" TEXT,
    "userId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AbonementTransaction_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Launch" ADD COLUMN "abonementWalletId" TEXT;

-- CreateIndex
CREATE INDEX "Abonement_tenantId_idx" ON "Abonement"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "AbonementWallet_tenantId_phone_key" ON "AbonementWallet"("tenantId", "phone");

-- CreateIndex
CREATE INDEX "AbonementWallet_tenantId_idx" ON "AbonementWallet"("tenantId");

-- CreateIndex
CREATE INDEX "AbonementTransaction_walletId_occurredAt_idx" ON "AbonementTransaction"("walletId", "occurredAt");

-- CreateIndex
CREATE INDEX "AbonementTransaction_launchId_idx" ON "AbonementTransaction"("launchId");

-- AddForeignKey
ALTER TABLE "Abonement" ADD CONSTRAINT "Abonement_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AbonementWallet" ADD CONSTRAINT "AbonementWallet_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AbonementTransaction" ADD CONSTRAINT "AbonementTransaction_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "AbonementWallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AbonementTransaction" ADD CONSTRAINT "AbonementTransaction_abonementId_fkey" FOREIGN KEY ("abonementId") REFERENCES "Abonement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AbonementTransaction" ADD CONSTRAINT "AbonementTransaction_launchId_fkey" FOREIGN KEY ("launchId") REFERENCES "Launch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AbonementTransaction" ADD CONSTRAINT "AbonementTransaction_pointId_fkey" FOREIGN KEY ("pointId") REFERENCES "Point"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AbonementTransaction" ADD CONSTRAINT "AbonementTransaction_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "Operator"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AbonementTransaction" ADD CONSTRAINT "AbonementTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Launch" ADD CONSTRAINT "Launch_abonementWalletId_fkey" FOREIGN KEY ("abonementWalletId") REFERENCES "AbonementWallet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Точки, где абонемент можно продать/пополнить — пусто = все точки тенанта
-- (запрос пользователя 2026-07-17: "выбор действует ли он на все точки
-- клиента или нет").
-- CreateTable
CREATE TABLE "_AbonementPoints" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_AbonementPoints_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_AbonementPoints_B_index" ON "_AbonementPoints"("B");

-- AddForeignKey
ALTER TABLE "_AbonementPoints" ADD CONSTRAINT "_AbonementPoints_A_fkey" FOREIGN KEY ("A") REFERENCES "Abonement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AbonementPoints" ADD CONSTRAINT "_AbonementPoints_B_fkey" FOREIGN KEY ("B") REFERENCES "Point"("id") ON DELETE CASCADE ON UPDATE CASCADE;
