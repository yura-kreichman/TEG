/*
  Warnings:

  - You are about to drop the column `topCities` on the `LandingDailyStat` table. All the data in the column will be lost.
  - You are about to drop the column `topCountries` on the `LandingDailyStat` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "LandingDailyStat" DROP COLUMN "topCities",
DROP COLUMN "topCountries";
