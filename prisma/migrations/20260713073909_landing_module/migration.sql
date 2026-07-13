-- CreateEnum
CREATE TYPE "LandingStatus" AS ENUM ('draft', 'published');

-- AlterTable
ALTER TABLE "Point" ADD COLUMN     "city" TEXT,
ADD COLUMN     "hoursNote" TEXT,
ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "PointOpeningHours" (
    "id" TEXT NOT NULL,
    "pointId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "isOpen" BOOLEAN NOT NULL DEFAULT false,
    "opensAt" TEXT,
    "closesAt" TEXT,

    CONSTRAINT "PointOpeningHours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantOldSlug" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenantOldSlug_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Landing" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "status" "LandingStatus" NOT NULL DEFAULT 'draft',
    "previewToken" TEXT NOT NULL,
    "tagline" TEXT,
    "aboutText" TEXT,
    "galleryEnabled" BOOLEAN NOT NULL DEFAULT false,
    "ourFleetEnabled" BOOLEAN NOT NULL DEFAULT false,
    "rulesInstructionId" TEXT,
    "contactPhone" TEXT,
    "contactTelegram" TEXT,
    "contactViber" TEXT,
    "contactWhatsapp" TEXT,
    "contactInstagram" TEXT,
    "contactFacebook" TEXT,
    "contactTiktok" TEXT,
    "metaTitleOverride" TEXT,
    "metaDescriptionOverride" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Landing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LandingGalleryPhoto" (
    "id" TEXT NOT NULL,
    "landingId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LandingGalleryPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LandingZoneContent" (
    "id" TEXT NOT NULL,
    "landingId" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "photoUrl" TEXT,
    "caption" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LandingZoneContent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LandingDailyStat" (
    "id" TEXT NOT NULL,
    "landingId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "visits" INTEGER NOT NULL DEFAULT 0,
    "uniqueVisitors" INTEGER NOT NULL DEFAULT 0,
    "sourceDirect" INTEGER NOT NULL DEFAULT 0,
    "sourceSearch" INTEGER NOT NULL DEFAULT 0,
    "sourceSocial" INTEGER NOT NULL DEFAULT 0,
    "deviceMobile" INTEGER NOT NULL DEFAULT 0,
    "deviceDesktop" INTEGER NOT NULL DEFAULT 0,
    "topCountries" JSONB,
    "topCities" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LandingDailyStat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LandingVisitorSeen" (
    "id" TEXT NOT NULL,
    "landingId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "visitorHash" TEXT NOT NULL,

    CONSTRAINT "LandingVisitorSeen_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PointOpeningHours_pointId_weekday_key" ON "PointOpeningHours"("pointId", "weekday");

-- CreateIndex
CREATE UNIQUE INDEX "TenantOldSlug_slug_key" ON "TenantOldSlug"("slug");

-- CreateIndex
CREATE INDEX "TenantOldSlug_tenantId_idx" ON "TenantOldSlug"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Landing_tenantId_key" ON "Landing"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Landing_previewToken_key" ON "Landing"("previewToken");

-- CreateIndex
CREATE INDEX "LandingGalleryPhoto_landingId_sortOrder_idx" ON "LandingGalleryPhoto"("landingId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "LandingZoneContent_zoneId_key" ON "LandingZoneContent"("zoneId");

-- CreateIndex
CREATE INDEX "LandingZoneContent_landingId_idx" ON "LandingZoneContent"("landingId");

-- CreateIndex
CREATE UNIQUE INDEX "LandingDailyStat_landingId_date_key" ON "LandingDailyStat"("landingId", "date");

-- CreateIndex
CREATE INDEX "LandingVisitorSeen_date_idx" ON "LandingVisitorSeen"("date");

-- CreateIndex
CREATE UNIQUE INDEX "LandingVisitorSeen_landingId_date_visitorHash_key" ON "LandingVisitorSeen"("landingId", "date", "visitorHash");

-- AddForeignKey
ALTER TABLE "PointOpeningHours" ADD CONSTRAINT "PointOpeningHours_pointId_fkey" FOREIGN KEY ("pointId") REFERENCES "Point"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantOldSlug" ADD CONSTRAINT "TenantOldSlug_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Landing" ADD CONSTRAINT "Landing_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Landing" ADD CONSTRAINT "Landing_rulesInstructionId_fkey" FOREIGN KEY ("rulesInstructionId") REFERENCES "Instruction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LandingGalleryPhoto" ADD CONSTRAINT "LandingGalleryPhoto_landingId_fkey" FOREIGN KEY ("landingId") REFERENCES "Landing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LandingZoneContent" ADD CONSTRAINT "LandingZoneContent_landingId_fkey" FOREIGN KEY ("landingId") REFERENCES "Landing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LandingZoneContent" ADD CONSTRAINT "LandingZoneContent_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LandingDailyStat" ADD CONSTRAINT "LandingDailyStat_landingId_fkey" FOREIGN KEY ("landingId") REFERENCES "Landing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
