-- CreateEnum
CREATE TYPE "LandingTheme" AS ENUM ('modern', 'classic', 'retro', 'festival', 'neon', 'pixel');

-- CreateEnum
CREATE TYPE "LandingEffect" AS ENUM ('none', 'snow', 'confetti', 'bubbles', 'leaves', 'sparks', 'petals');

-- AlterTable
ALTER TABLE "Landing" ADD COLUMN     "contactYoutube" TEXT,
ADD COLUMN     "effect" "LandingEffect" NOT NULL DEFAULT 'none',
ADD COLUMN     "theme" "LandingTheme" NOT NULL DEFAULT 'modern',
ADD COLUMN     "videoEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "videoPoster" TEXT,
ADD COLUMN     "videoYoutubeId" TEXT;
