-- CreateTable
CREATE TABLE "AssetInitialReading" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "tariffId" TEXT NOT NULL,
    "reading" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssetInitialReading_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AssetInitialReading_assetId_tariffId_key" ON "AssetInitialReading"("assetId", "tariffId");

-- AddForeignKey
ALTER TABLE "AssetInitialReading" ADD CONSTRAINT "AssetInitialReading_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetInitialReading" ADD CONSTRAINT "AssetInitialReading_tariffId_fkey" FOREIGN KEY ("tariffId") REFERENCES "Tariff"("id") ON DELETE CASCADE ON UPDATE CASCADE;
