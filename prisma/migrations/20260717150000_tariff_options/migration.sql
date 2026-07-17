-- "За вход" — несколько вариантов длительность+цена на тариф (запрос
-- пользователя 2026-07-17), вместо одной пары Tariff.price/durationMinutes.

CREATE TABLE "TariffOption" (
    "id" TEXT NOT NULL,
    "tariffId" TEXT NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "order" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TariffOption_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TariffOption_tariffId_order_idx" ON "TariffOption"("tariffId", "order");

ALTER TABLE "TariffOption" ADD CONSTRAINT "TariffOption_tariffId_fkey"
    FOREIGN KEY ("tariffId") REFERENCES "Tariff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Tariff" DROP COLUMN "durationMinutes";
